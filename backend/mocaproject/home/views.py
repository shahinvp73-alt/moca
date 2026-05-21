from django.shortcuts import render
from django.http import HttpResponse
from rest_framework.decorators import api_view
from django.db.models import Q
from django.utils import timezone
from .serializers import message_serializer, work_serializer
from rest_framework.response import Response
from home.models import Message, User, Work

# Create your views here.


@api_view(['POST'])
def assign_work(request):

    serializer = work_serializer.WorkSerializer(data=request.data)

    if serializer.is_valid():
        work = serializer.save()

        # Send automated message notification
        try:
            body = f"🔔 NEW TASK ASSIGNED: {work.title}\n\nDescription: {work.description}\n\nPlease check your task dashboard to accept and start working."
            message = Message(sender=work.manager, receiver=work.employee)
            message.set_body(body)
            message.save()
        except Exception as e:
            print(f"Failed to send auto-message: {e}")

        return Response({
            "message": "Work assigned and notification sent"
        })

    return Response(serializer.errors, status=400)


@api_view(['GET'])
def employee_work(request, employee_id):
    if request.user.role != "manager" and request.user.id != employee_id:
        return Response({"error": "You can only view your own work"}, status=403)

    works = Work.objects.filter(employee_id=employee_id)

    serializer = work_serializer.WorkSerializer(works, many=True)

    return Response(serializer.data)


@api_view(["PUT"])
def update_work(request, pk):
    try:
        work = Work.objects.get(id=pk)
    except Work.DoesNotExist:
        return Response({"error": "Work not found"}, status=404)

    was_completed = work.status == "completed"

    serializer = work_serializer.WorkSerializer(work, data=request.data, partial=True)

    if serializer.is_valid():
        updated_work = serializer.save()
        
        # If it was just marked as completed, record the timestamp
        if request.data.get("status") == "completed" and not was_completed:
            updated_work.completed_at = timezone.now()
            updated_work.save(update_fields=["completed_at"])
            
        return Response({
            "message": "Work updated successfully",
            "data": work_serializer.WorkSerializer(updated_work).data
        })

    return Response(serializer.errors, status=400)


@api_view(["DELETE"])
def delete_work(request, pk):
    try:
        work = Work.objects.get(id=pk)
        work.delete()
        return Response({"message": "Work deleted successfully"})
    except Work.DoesNotExist:
        return Response({"error": "Work not found"}, status=404)

@api_view(['GET'])
def all_work(request):

    works = Work.objects.all()

    serializer = work_serializer.WorkSerializer(works, many=True)

    return Response(serializer.data)


@api_view(["GET"])
def conversation(request, user_id, contact_id):
    if request.user.id != user_id:
        return Response({"error": "You can only view your own conversations"}, status=403)

    messages = Message.objects.filter(
        Q(sender_id=user_id, receiver_id=contact_id) |
        Q(sender_id=contact_id, receiver_id=user_id)
    ).select_related("sender", "receiver").order_by("created_at")

    serializer = message_serializer.MessageSerializer(messages, many=True)
    return Response(serializer.data)


@api_view(["GET"])
def unread_message_count(request, user_id):
    if request.user.id != user_id:
        return Response({"error": "You can only view your own unread count"}, status=403)

    count = Message.objects.filter(receiver_id=user_id, seen_at__isnull=True).count()
    return Response({"count": count})


@api_view(["GET"])
def message_summaries(request, user_id):
    if request.user.id != user_id:
        return Response({"error": "You can only view your own message summaries"}, status=403)

    try:
        User.objects.get(id=user_id)
    except User.DoesNotExist:
        return Response({"error": "User not found"}, status=404)

    contacts = User.objects.filter(is_approved=True, is_superuser=False, is_staff=False).exclude(id=user_id).order_by("username")
    summaries = []

    for contact in contacts:
        conversation_messages = Message.objects.filter(
            Q(sender_id=user_id, receiver_id=contact.id) |
            Q(sender_id=contact.id, receiver_id=user_id)
        )
        latest = conversation_messages.order_by("-created_at").first()
        unread_count = conversation_messages.filter(
            sender_id=contact.id,
            receiver_id=user_id,
            seen_at__isnull=True,
        ).count()

        status_text = "No messages"
        if unread_count > 0:
            status_text = "Unread"
        elif latest and latest.sender_id == int(user_id):
            status_text = "Seen" if latest.seen_at else "Not read"
        elif latest:
            status_text = "Read"

        summaries.append({
            "contact": contact.id,
            "total_count": conversation_messages.count(),
            "unread_count": unread_count,
            "latest_sender": latest.sender_id if latest else None,
            "latest_seen": bool(latest and latest.seen_at),
            "status": status_text,
        })

    return Response(summaries)


@api_view(["POST"])
def mark_conversation_seen(request, user_id, contact_id):
    if request.user.id != user_id:
        return Response({"error": "You can only mark your own messages as seen"}, status=403)

    now = timezone.now()
    updated = Message.objects.filter(
        sender_id=contact_id,
        receiver_id=user_id,
        seen_at__isnull=True,
    ).update(seen_at=now)

    return Response({"updated": updated})


@api_view(["POST"])
def send_message(request):
    sender_id = request.data.get("sender")
    receiver_id = request.data.get("receiver")
    body = (request.data.get("body") or "").strip()

    if not sender_id or not receiver_id or not body:
        return Response({"error": "sender, receiver, and body are required"}, status=400)

    if str(sender_id) == str(receiver_id):
        return Response({"error": "Cannot send a message to yourself"}, status=400)

    if str(request.user.id) != str(sender_id):
        return Response({"error": "You can only send messages as yourself"}, status=403)

    try:
        sender = User.objects.get(id=sender_id)
        receiver = User.objects.get(id=receiver_id)
    except User.DoesNotExist:
        return Response({"error": "Sender or receiver not found"}, status=404)

    if not sender.is_approved or not receiver.is_approved:
        return Response({"error": "Both users must be approved before messaging"}, status=400)

    # Exclude sending messages to superusers or staff
    if receiver.is_superuser or receiver.is_staff:
        return Response({"error": "Cannot send messages to superusers or staff members"}, status=400)

    message = Message(sender=sender, receiver=receiver)
    message.set_body(body)
    message.save()

    serializer = message_serializer.MessageSerializer(message)
    return Response(serializer.data, status=201)


@api_view(["PUT"])
def edit_message(request, pk):
    sender_id = request.data.get("sender")
    body = (request.data.get("body") or "").strip()

    if not sender_id or not body:
        return Response({"error": "sender and body are required"}, status=400)

    try:
        message = Message.objects.get(id=pk)
    except Message.DoesNotExist:
        return Response({"error": "Message not found"}, status=404)

    if str(message.sender_id) != str(sender_id):
        return Response({"error": "Only the sender can edit this message"}, status=403)

    if request.user.id != message.sender_id:
        return Response({"error": "You can only edit your own messages"}, status=403)

    message.set_body(body)
    message.edited_at = timezone.now()
    message.save(update_fields=["encrypted_body", "edited_at"])

    serializer = message_serializer.MessageSerializer(message)
    return Response(serializer.data)


@api_view(["DELETE"])
def delete_message(request, pk):
    sender_id = request.data.get("sender")

    if not sender_id:
        return Response({"error": "sender is required"}, status=400)

    try:
        message = Message.objects.get(id=pk)
    except Message.DoesNotExist:
        return Response({"error": "Message not found"}, status=404)

    if str(message.sender_id) != str(sender_id):
        return Response({"error": "Only the sender can delete this message"}, status=403)

    if request.user.id != message.sender_id:
        return Response({"error": "You can only delete your own messages"}, status=403)

    message.delete()
    return Response({"message": "Message deleted"})

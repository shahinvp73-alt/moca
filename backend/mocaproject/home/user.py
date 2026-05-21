from rest_framework.decorators import api_view
from rest_framework.decorators import permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.contrib.auth import authenticate
from .serializers import user_serializer
from home.models import User, PasswordResetOTP
from rest_framework import status
from rest_framework.authtoken.models import Token
import secrets
import logging
from django.core.mail import send_mail
from django.conf import settings

logger = logging.getLogger(__name__)


@api_view(['POST'])
@permission_classes([AllowAny])
def register(request):
    serializer = user_serializer.RegisterSerializer(data=request.data)

    if serializer.is_valid():
        user = serializer.save()

        return Response({
            "message": "Registered successfully. Wait for admin approval",
            "user_id": user.id
        }, status=201)

    return Response({
        "message": "Registration failed",
        "errors": serializer.errors
    }, status=400)




@api_view(['POST'])
@permission_classes([AllowAny])
def login(request):

    username = request.data.get("username")
    password = request.data.get("password")

    user = authenticate(username=username, password=password)

    if not user:
        return Response(
            {"error": "Invalid credentials"},
            status=status.HTTP_401_UNAUTHORIZED
        )

    if not user.is_approved:
        return Response(
            {"error": "Account not approved by admin"},
            status=status.HTTP_403_FORBIDDEN
        )

    token, _ = Token.objects.get_or_create(user=user)

    # Common response for React
    response_data = {
        "message": "Login successful",
        "token": token.key,
        "user_id": user.id,
        "username": user.username,
        "role": user.role,
    }

    # If manager, send employees list
    if user.role == "manager":
        employees = User.objects.filter(role="employee")
        serializer = user_serializer.UserSerializer(employees, many=True)

        response_data["employees"] = serializer.data

    # If employee, send own details
    else:
        serializer = user_serializer.UserSerializer(user)
        response_data["employee"] = serializer.data

    return Response(response_data)


@api_view(['GET'])
def me(request):
    serializer = user_serializer.UserSerializer(request.user)
    return Response(serializer.data)

# employee_list
@api_view(['GET'])
def employee_list(request):

    employees = User.objects.filter(role="employee")

    data = []

    for employee in employees:
        data.append({
            "id": employee.id,
            "username": employee.username,
            "email": employee.email,
            "is_approved": employee.is_approved
        })

    return Response(data)


@api_view(['GET'])
def manager_list(request):

    managers = User.objects.filter(role="manager")

    data = []

    for manager in managers:
        data.append({
            "id": manager.id,
            "username": manager.username,
            "email": manager.email,
            "is_approved": manager.is_approved
        })

    return Response(data)


@api_view(['GET'])
def user_list(request):
    users = User.objects.filter(is_approved=True).exclude(id=request.user.id).order_by("username")
    exclude_id = request.query_params.get("exclude_id")

    if exclude_id:
        users = users.exclude(id=exclude_id)

    serializer = user_serializer.UserSerializer(users, many=True)

    return Response(serializer.data)


@api_view(['PUT'])
def approve_employee(request, id):

    try:
        employee = User.objects.get(id=id)
        employee.is_approved = True
        employee.save()

        return Response({
            "message": "Employee approved"
        })

    except User.DoesNotExist:
        return Response(
            {"error": "Employee not found"},
            status=status.HTTP_404_NOT_FOUND
        )


@api_view(['DELETE'])
def delete_employee(request, id):

    try:
        employee = User.objects.get(id=id)
        employee.delete()

        return Response({
            "message": "Employee deleted"
        })

    except User.DoesNotExist:
        return Response(
            {"error": "Employee not found"},
            status=status.HTTP_404_NOT_FOUND
        )
@api_view(['POST'])
@permission_classes([AllowAny])
def request_password_reset_otp(request):
    username = (request.data.get("username") or "").strip()
    email = (request.data.get("email") or "").strip().lower()
    
    if not username or not email:
        return Response({"error": "Username and email are required"}, status=400)

    try:
        user = User.objects.filter(username__iexact=username, email__iexact=email).first()
        if not user:
            return Response({"error": "No account found with this username and email."}, status=400)
    except Exception:
        logger.exception("Password reset user lookup failed")
        return Response({"error": "An error occurred while searching for the user."}, status=503)

    try:
        PasswordResetOTP.objects.filter(email=email).delete()

        # Generate 6-digit OTP
        otp = f"{secrets.randbelow(1000000):06d}"
        otp_record = PasswordResetOTP.objects.create(email=email, otp=otp)
    except Exception:
        logger.exception("Password reset OTP database operation failed")
        return Response({
            "error": "Password reset service is not ready. Please try again later."
        }, status=503)

    # Send Email
    subject = "Your Password Reset OTP"
    message = f"Hello {user.username},\n\nYour 6-digit OTP for password reset is: {otp}\n\nThis OTP is valid for 60 seconds.\n\nIf you did not request this, please ignore this email."

    using_smtp = settings.EMAIL_BACKEND == "django.core.mail.backends.smtp.EmailBackend"
    if using_smtp and (not settings.EMAIL_HOST_USER or not settings.EMAIL_HOST_PASSWORD):
        otp_record.delete()
        missing_settings = []
        if not settings.EMAIL_HOST_USER:
            missing_settings.append("EMAIL_HOST_USER")
        if not settings.EMAIL_HOST_PASSWORD:
            missing_settings.append("EMAIL_HOST_PASSWORD")

        return Response({
            "error": (
                "Email service is not configured. Add "
                f"{', '.join(missing_settings)} to {settings.EMAIL_ENV_FILE}, "
                "then restart the backend."
            )
        }, status=503)
    
    try:
        send_mail(subject, message, settings.DEFAULT_FROM_EMAIL, [email], fail_silently=False)
    except Exception as exc:
        otp_record.delete()
        logger.exception("Failed to send password reset email")
        return Response({
            "error": (
                "Failed to send OTP email. Check EMAIL_HOST_USER and "
                "EMAIL_HOST_PASSWORD in Render environment variables."
            ),
            "detail": exc.__class__.__name__,
        }, status=503)

    return Response({"message": "OTP sent successfully to your email."})


@api_view(['POST'])
@permission_classes([AllowAny])
def verify_password_reset_otp(request):
    email = (request.data.get("email") or "").strip().lower()
    otp = (request.data.get("otp") or "").strip()

    if not email or not otp:
        return Response({"error": "Email and OTP are required"}, status=400)

    latest_otp = PasswordResetOTP.objects.filter(email=email).order_by('-created_at').first()

    if not latest_otp:
        return Response({"error": "Invalid OTP"}, status=400)

    if latest_otp.is_expired():
        latest_otp.delete()
        return Response({"error": "OTP has expired"}, status=400)

    if latest_otp.is_verified:
        return Response({"error": "OTP already used. Please request a new OTP."}, status=400)

    if latest_otp.otp != otp:
        latest_otp.delete()
        return Response({"error": "Invalid OTP. Please request a new OTP."}, status=400)

    latest_otp.is_verified = True
    latest_otp.save()

    return Response({"message": "OTP verified successfully. You can now reset your password."})


@api_view(['POST'])
@permission_classes([AllowAny])
def reset_password(request):
    email = (request.data.get("email") or "").strip().lower()
    otp = (request.data.get("otp") or "").strip()
    new_password = request.data.get("password")

    if not email or not otp or not new_password:
        return Response({"error": "Email, OTP and new password are required"}, status=400)

    # Check if OTP was verified
    otp_record = PasswordResetOTP.objects.filter(email=email, otp=otp, is_verified=True).order_by('-created_at').first()

    if not otp_record:
        return Response({"error": "OTP not verified or invalid"}, status=400)

    if otp_record.is_expired():
        otp_record.delete()
        return Response({"error": "OTP session expired. Please request a new one."}, status=400)

    try:
        user = User.objects.filter(email__iexact=email).first()
        if not user:
            return Response({"error": "User not found"}, status=404)
        user.set_password(new_password)
        user.save()
        
        # Delete OTP records for this email after successful reset
        PasswordResetOTP.objects.filter(email=email).delete()
        
        return Response({"message": "Password reset successful. You can now login with your new password."})
    except User.DoesNotExist:
        return Response({"error": "User not found"}, status=404)

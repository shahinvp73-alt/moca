import logging

from django.http import JsonResponse


logger = logging.getLogger(__name__)


class JsonExceptionMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        try:
            return self.get_response(request)
        except Exception:
            logger.exception("Unhandled request error")
            return JsonResponse(
                {"error": "Server error. Please try again later."},
                status=500,
            )

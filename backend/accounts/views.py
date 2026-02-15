# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: accounts/views.py
# Copyright (c) 2024

import json
from django.contrib.auth import authenticate, login, logout, update_session_auth_hash
from django.http import JsonResponse
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_http_methods
from django.middleware.csrf import get_token


@ensure_csrf_cookie
@require_http_methods(["GET"])
def get_csrf_token(request):
    """Return a CSRF token for the frontend to use in subsequent requests."""
    token = get_token(request)
    return JsonResponse({"csrfToken": token})


@require_http_methods(["POST"])
def login_view(request):
    """Authenticate a user with username and password."""
    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid request body"}, status=400)

    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not username or not password:
        return JsonResponse({"error": "Username and password are required"}, status=400)

    user = authenticate(request, username=username, password=password)
    if user is not None:
        login(request, user)
        return JsonResponse({
            "success": True,
            "user": {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "firstName": user.first_name,
                "lastName": user.last_name,
            }
        })
    else:
        return JsonResponse({"error": "Invalid credentials"}, status=401)


@require_http_methods(["POST"])
def logout_view(request):
    """Log the current user out."""
    logout(request)
    return JsonResponse({"success": True})


@require_http_methods(["GET"])
def session_status(request):
    """Check if the current session is authenticated."""
    if request.user.is_authenticated:
        return JsonResponse({
            "isAuthenticated": True,
            "user": {
                "id": request.user.id,
                "username": request.user.username,
                "email": request.user.email,
                "firstName": request.user.first_name,
                "lastName": request.user.last_name,
            }
        })
    return JsonResponse({"isAuthenticated": False}, status=200)


@require_http_methods(["POST"])
def change_password(request):
    """Allow an authenticated user to change their password."""
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required"}, status=401)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid request body"}, status=400)

    current_password = data.get("currentPassword", "")
    new_password = data.get("newPassword", "")

    if not current_password or not new_password:
        return JsonResponse(
            {"error": "Current password and new password are required"},
            status=400,
        )

    if len(new_password) < 8:
        return JsonResponse(
            {"error": "New password must be at least 8 characters"},
            status=400,
        )

    if not request.user.check_password(current_password):
        return JsonResponse({"error": "Current password is incorrect"}, status=400)

    request.user.set_password(new_password)
    request.user.save()

    # Keep the user logged in after password change
    update_session_auth_hash(request, request.user)

    return JsonResponse({"success": True})

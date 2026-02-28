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
from django.contrib.auth.models import User
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

    identifier = data.get("username", "").strip()
    password = data.get("password", "")

    if not identifier or not password:
        return JsonResponse({"error": "Email and password are required"}, status=400)

    # Allow login by email or username
    username = identifier
    if "@" in identifier:
        try:
            username = User.objects.get(email__iexact=identifier).username
        except User.DoesNotExist:
            return JsonResponse({"error": "Invalid credentials"}, status=401)

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
        from feature_extractor.models import StudyMembership
        memberships = StudyMembership.objects.filter(user=request.user).select_related('study')
        study_roles = {str(m.study_id): m.role for m in memberships}
        return JsonResponse({
            "isAuthenticated": True,
            "user": {
                "id": request.user.id,
                "username": request.user.username,
                "email": request.user.email,
                "firstName": request.user.first_name,
                "lastName": request.user.last_name,
                "isSuperuser": request.user.is_superuser,
                "studyRoles": study_roles,
            }
        })
    return JsonResponse({"isAuthenticated": False}, status=200)



@require_http_methods(["GET"])
def list_users(request):
    """List all users. Requires authentication."""
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required"}, status=401)
    users = User.objects.all().order_by('username').values(
        'id', 'username', 'email', 'first_name', 'last_name', 'is_active'
    )
    return JsonResponse(list(users), safe=False)


@require_http_methods(["POST"])
def create_user(request):
    """Create a new Django user. Requires superuser."""
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required"}, status=401)
    if not request.user.is_superuser:
        return JsonResponse({"error": "Only superusers can create users"}, status=403)

    try:
        data = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Invalid request body"}, status=400)

    username = data.get("username", "").strip()
    email = data.get("email", "").strip()
    password = data.get("password", "")
    first_name = data.get("firstName", "").strip()
    last_name = data.get("lastName", "").strip()

    if not username:
        return JsonResponse({"error": "Username is required"}, status=400)
    if not password or len(password) < 8:
        return JsonResponse({"error": "Password must be at least 8 characters"}, status=400)
    if User.objects.filter(username=username).exists():
        return JsonResponse({"error": "Username already exists"}, status=400)
    if email and User.objects.filter(email__iexact=email).exists():
        return JsonResponse({"error": "Email already in use"}, status=400)

    user = User.objects.create_user(
        username=username,
        email=email,
        password=password,
        first_name=first_name,
        last_name=last_name,
    )
    return JsonResponse({
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "firstName": user.first_name,
        "lastName": user.last_name,
    }, status=201)


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

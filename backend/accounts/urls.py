# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: accounts/urls.py
# Copyright (c) 2024

from django.urls import path
from . import views

app_name = "accounts"

urlpatterns = [
    path("csrf/", views.get_csrf_token, name="csrf"),
    path("login/", views.login_view, name="login"),
    path("logout/", views.logout_view, name="logout"),
    path("status/", views.session_status, name="status"),
    path("password/", views.change_password, name="change-password"),
]

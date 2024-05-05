from django.contrib import admin
from django.conf import settings
from django.contrib import admin
from django.urls import path, include 
from django.conf import settings
from django.conf.urls.static import static

from upload.views import image_upload

urlpatterns = [
    path("", image_upload, name="upload"),
    path("admin/", admin.site.urls),
    path("api/feature_extractor/", include('feature_extractor.urls')),  
    path("api/datasets/", include('datasets.urls')),  
    path('data/api/', include([
        path('datasets/', include('datasets.urls')),
        path('feature_extractor/', include('feature_extractor.urls')),
    ])),
]

# Handling static files during development
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

from django.apps import AppConfig


class FeatureExtractorConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'feature_extractor'
    
    # def ready(self):
    #     import feature_extractor.signals 
# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: celery_app.py
# Copyright (c) 2024

import os
from celery import Celery
from celery.signals import after_setup_logger
import logging

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'app.settings')

app = Celery('app')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()

app.log.setup_logging_subsystem(loglevel=logging.INFO)


@after_setup_logger.connect
def setup_redis_log_handler(logger, **kwargs):
    """
    Attach the Redis log handler to the celery worker logger so all
    training output is published to Redis for real-time streaming.
    """
    from log_handler import RedisLogHandler

    redis_url = os.environ.get('CELERY_BROKER_URL', 'redis://redis:6379/0')
    handler = RedisLogHandler(redis_url=redis_url)
    handler.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)

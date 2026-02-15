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
from celery.signals import worker_process_init
import logging

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'app.settings')

app = Celery('app')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()

app.log.setup_logging_subsystem(loglevel=logging.INFO)


def _attach_redis_handler(logger):
    """
    Attach the Redis log handler to a logger, skipping if already present.
    """
    from log_handler import RedisLogHandler

    for h in logger.handlers:
        if isinstance(h, RedisLogHandler):
            return

    redis_url = os.environ.get('CELERY_BROKER_URL', 'redis://redis:6379/0')
    handler = RedisLogHandler(redis_url=redis_url)
    handler.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)


@worker_process_init.connect
def on_worker_process_init(**kwargs):
    """
    Fires inside each forked worker child process. This is the only reliable
    way to attach handlers in prefork mode since after_setup_logger only
    fires in the main process and forked children don't inherit the handler.
    """
    root = logging.getLogger()
    _attach_redis_handler(root)

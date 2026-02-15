# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: log_handler.py
# Copyright (c) 2024

import logging
import json
import time
import redis


class RedisLogHandler(logging.Handler):
    """
    Custom logging handler that publishes log records to a Redis pub/sub channel.
    This captures all celery worker log output and makes it available for
    real-time streaming via SSE without modifying task code.
    """

    def __init__(self, redis_url='redis://redis:6379/0', channel_prefix='training_logs'):
        super().__init__()
        self.channel_prefix = channel_prefix
        try:
            self.redis_client = redis.Redis.from_url(redis_url)
            # Test the connection
            self.redis_client.ping()
        except Exception:
            self.redis_client = None

    def emit(self, record):
        if not self.redis_client:
            return

        try:
            msg = self.format(record)
            data = json.dumps({
                'timestamp': time.time(),
                'level': record.levelname,
                'message': msg,
            })

            # Publish to the global training logs channel
            self.redis_client.publish(f'{self.channel_prefix}:all', data)

            # Also maintain a rolling buffer (last 500 lines) for late joiners
            self.redis_client.rpush(f'{self.channel_prefix}:buffer', data)
            self.redis_client.ltrim(f'{self.channel_prefix}:buffer', -500, -1)
            # Expire the buffer after 24h in case no one cleans it up
            self.redis_client.expire(f'{self.channel_prefix}:buffer', 86400)

        except Exception:
            # Never let logging errors break the worker
            pass

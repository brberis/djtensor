# Shark AI
# Author: Cristobal Barberis
# License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)
# For academic use only. Commercial use is prohibited without prior written permission.
# Contact: cristobal@barberis.com
#
# File: views.py
# Copyright (c) 2024

import json
import logging
import os
import time

import redis
from django.http import StreamingHttpResponse, JsonResponse
from django.views.decorators.http import require_http_methods
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated

from .models import TrainingSession
from .tasks import train_model

logger = logging.getLogger(__name__)

REDIS_URL = os.environ.get('CELERY_BROKER_URL', 'redis://redis:6379/0')
LOG_CHANNEL = 'training_logs'


@require_http_methods(["GET"])
def stream_training_logs(request, session_id):
    """
    SSE endpoint that streams celery worker logs in real time via Redis pub/sub.
    Read-only, one-way stream. Requires authenticated session cookie.
    """
    if not request.user.is_authenticated:
        return JsonResponse({"error": "Authentication required"}, status=401)

    try:
        TrainingSession.objects.get(pk=session_id)
    except TrainingSession.DoesNotExist:
        return JsonResponse({"error": "Session not found"}, status=404)

    def event_stream():
        """Generator yielding SSE events from Redis pub/sub."""
        r = None
        pubsub = None
        try:
            r = redis.Redis.from_url(REDIS_URL)

            # First, send buffered history so the user sees recent output
            buffered = r.lrange(f'{LOG_CHANNEL}:buffer', 0, -1)
            for item in buffered:
                try:
                    data = json.loads(item)
                    msg = data.get('message', '')
                    if msg:
                        escaped = msg.replace('\n', '\ndata: ')
                        yield f"data: {escaped}\n\n"
                except (json.JSONDecodeError, KeyError):
                    pass

            # Now subscribe to live updates
            pubsub = r.pubsub()
            pubsub.subscribe(f'{LOG_CHANNEL}:all')

            # Send heartbeat every 15s to keep the connection alive
            last_heartbeat = time.time()

            for message in pubsub.listen():
                if message['type'] == 'message':
                    try:
                        data = json.loads(message['data'])
                        msg = data.get('message', '')
                        if msg:
                            escaped = msg.replace('\n', '\ndata: ')
                            yield f"data: {escaped}\n\n"
                    except (json.JSONDecodeError, KeyError):
                        pass

                # Periodic heartbeat to prevent connection timeout
                now = time.time()
                if now - last_heartbeat > 15:
                    yield ": heartbeat\n\n"
                    last_heartbeat = now

        except GeneratorExit:
            pass
        except Exception as e:
            logger.error("Log stream error: %s", e)
            yield f"data: [stream error: {str(e)}]\n\n"
        finally:
            if pubsub:
                try:
                    pubsub.unsubscribe()
                    pubsub.close()
                except Exception:
                    pass

    response = StreamingHttpResponse(
        event_stream(),
        content_type='text/event-stream',
    )
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'
    return response


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def retrain_session(request, session_id):
    """
    Re-queue a failed or completed training session.
    Resets the status to Pending and dispatches the training task.
    """
    try:
        session = TrainingSession.objects.get(pk=session_id)
    except TrainingSession.DoesNotExist:
        return JsonResponse({"error": "Session not found"}, status=404)

    if session.status not in ('Completed', 'Failed'):
        return JsonResponse(
            {"error": f"Cannot retrain session with status '{session.status}'"},
            status=400,
        )

    # Reset status and clear old epochs
    session.status = 'Pending'
    session.save()
    session.epochs.all().delete()

    # Dispatch the training task
    train_model.apply_async((session.id,))

    return JsonResponse({
        "success": True,
        "message": f"Training session '{session.name}' queued for re-training",
    })

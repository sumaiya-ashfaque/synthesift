"""System endpoints used by operations and the development dashboard."""

import logging

import redis
from django.conf import settings
from django.db import connection
from drf_spectacular.utils import extend_schema
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

logger = logging.getLogger(__name__)


class LiveResponse(serializers.Serializer):
    status = serializers.ChoiceField(choices=["ok"])
    service = serializers.CharField()


class ReadyResponse(serializers.Serializer):
    status = serializers.ChoiceField(choices=["ok", "unavailable"])
    dependencies = serializers.DictField(child=serializers.ChoiceField(choices=["ok", "unavailable"]))


class MetadataResponse(serializers.Serializer):
    name = serializers.CharField()
    version = serializers.CharField()
    milestone = serializers.CharField()


class LiveView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(tags=["system"], responses={200: LiveResponse})
    def get(self, request):
        return Response({"status": "ok", "service": "synthesift-api"})


class ReadyView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(tags=["system"], responses={200: ReadyResponse, 503: ReadyResponse})
    def get(self, request):
        dependencies = {"database": "unavailable", "redis": "unavailable"}
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                if cursor.fetchone() == (1,):
                    dependencies["database"] = "ok"
        except Exception:
            logger.warning("readiness.database_unavailable")

        try:
            client = redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=1, socket_timeout=1)
            try:
                if client.ping():
                    dependencies["redis"] = "ok"
            finally:
                client.close()
        except (redis.RedisError, OSError, ValueError):
            logger.warning("readiness.redis_unavailable")

        ready = all(value == "ok" for value in dependencies.values())
        return Response(
            {"status": "ok" if ready else "unavailable", "dependencies": dependencies},
            status=status.HTTP_200_OK if ready else status.HTTP_503_SERVICE_UNAVAILABLE,
        )


class MetadataView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    @extend_schema(tags=["system"], responses={200: MetadataResponse})
    def get(self, request):
        return Response({"name": "SyntheSift", "version": "0.1.0", "milestone": "M0"})

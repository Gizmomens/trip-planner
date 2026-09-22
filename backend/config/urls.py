from django.urls import path

from trips.api import views

urlpatterns = [
    path("api/v1/bootstrap", views.bootstrap),
    path("api/v1/locations", views.locations),
    path("api/v1/trips", views.trips),
]
handler404 = "trips.api.views.not_found"
handler500 = "trips.api.views.server_error"

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../core/providers.dart';
import 'rider_helpers.dart';
import 'rider_providers.dart';

/// Periodic GPS ping while on duty (mirrors web main.js: 20s interval).
/// On permission denial / GPS failure it falls back to the last known rider
/// coordinates, the active job's store, or the home store — never crashes.
class RiderLocationService {
  RiderLocationService(this._ref);

  final Ref _ref;
  Timer? _timer;
  bool _busy = false;
  double? _fallbackLat;
  double? _fallbackLng;

  static const Duration pingInterval = Duration(seconds: 20);
  static const Duration gpsTimeout = Duration(seconds: 8);

  bool get isRunning => _timer != null;

  void start() {
    if (_timer != null) return;
    _ping();
    _timer = Timer.periodic(pingInterval, (_) => _ping());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  Future<void> _ping() async {
    if (_busy) return;
    _busy = true;
    try {
      final coords = await _gpsCoords() ?? await _fallbackCoords();
      if (coords == null) return;
      await _ref.read(apiProvider).riderLocation(coords.$1, coords.$2);
      _fallbackLat = coords.$1;
      _fallbackLng = coords.$2;
    } catch (_) {
      // Transient network / platform error — the next ping retries.
    } finally {
      _busy = false;
    }
  }

  Future<(double, double)?> _gpsCoords() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        _setHint('Location services are off — sharing your home-store location while on duty. Turn on GPS for live tracking.');
        return null;
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever ||
          permission == LocationPermission.unableToDetermine) {
        _setHint('Location permission denied — sharing your home-store location instead. Allow location in Settings for live GPS tracking.');
        return null;
      }
      final pos = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.medium,
          timeLimit: gpsTimeout,
        ),
      );
      _setHint(null);
      return (pos.latitude, pos.longitude);
    } catch (_) {
      _setHint('Could not read GPS right now — sharing your last known location.');
      return null;
    }
  }

  Future<(double, double)?> _fallbackCoords() async {
    if (_fallbackLat != null && _fallbackLng != null) {
      return (_fallbackLat!, _fallbackLng!);
    }
    final rider = _ref.read(riderProfileProvider).valueOrNull;
    if (rider != null && (rider.lat != 0 || rider.lng != 0)) {
      return (rider.lat, rider.lng);
    }
    final active = _ref.read(riderActiveJobsProvider);
    for (final job in active) {
      if (hasCoords(job.store)) {
        return ((job.store['lat'] as num).toDouble(), (job.store['lng'] as num).toDouble());
      }
    }
    try {
      final home = await _ref.read(riderHomeStoreProvider.future);
      if (home != null && (home.lat != 0 || home.lng != 0)) {
        return (home.lat, home.lng);
      }
    } catch (_) {
      // No fallback available — skip this ping.
    }
    return null;
  }

  void _setHint(String? hint) {
    _ref.read(riderLocationHintProvider.notifier).state = hint;
  }
}

final riderLocationServiceProvider = Provider<RiderLocationService>((ref) {
  final service = RiderLocationService(ref);
  ref.onDispose(service.stop);
  return service;
});
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/theme.dart';

/// Offer acceptance window, mirrors the web rider app (60 seconds).
const int offerWindowSeconds = 60;

/// Integer paise: payout + tip. Never do float money math.
int jobPayMinor(Job job) => job.payoutMinor + job.tipMinor;

double _coord(Map<String, dynamic> m, String key) {
  final v = m[key];
  return v is num ? v.toDouble() : double.tryParse('$v') ?? 0;
}

bool hasCoords(Map<String, dynamic> m) {
  final lat = m['lat'], lng = m['lng'];
  return lat is num && lng is num && (lat != 0 || lng != 0);
}

double haversineKm(double aLat, double aLng, double bLat, double bLng) {
  if (aLat == 0 && aLng == 0 || bLat == 0 && bLng == 0) return 0;
  const r = 6371.0;
  double toRad(double d) => d * math.pi / 180;
  final dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  final h = math.sin(dLat / 2) * math.sin(dLat / 2) +
      math.cos(toRad(aLat)) * math.cos(toRad(bLat)) * math.sin(dLng / 2) * math.sin(dLng / 2);
  return 2 * r * math.asin(math.sqrt(h.clamp(0.0, 1.0)));
}

double tripKm(Job job) => haversineKm(
      _coord(job.store, 'lat'), _coord(job.store, 'lng'),
      _coord(job.drop, 'lat'), _coord(job.drop, 'lng'),
    );

String tripLabel(Job job) => distanceLabel(tripKm(job));

/// Rough riding estimate at ~20 km/h plus a 2-minute handover buffer.
int etaMinutes(Job job) => math.max(3, (tripKm(job) * 3).round() + 2);

DateTime? _parseIso(dynamic v) => v is String ? DateTime.tryParse(v) : null;

DateTime? offerExpiresAt(Job job) {
  final offered = _parseIso(job.raw['offered_at']);
  if (offered == null) return null;
  return offered.add(const Duration(seconds: offerWindowSeconds));
}

String jobField(Job job, String key) {
  final v = job.raw[key];
  return v == null ? '' : '$v';
}

String jobLabel(Job job) =>
    job.publicLabel.isNotEmpty ? job.publicLabel : (job.orderId.isNotEmpty ? job.orderId : job.id);

String storeName(Job job) {
  final v = job.store['name'];
  return v is String && v.isNotEmpty ? v : 'Store';
}

String storeAddress(Job job) => (job.store['address'] ?? '').toString();

String receiverName(Job job) {
  final v = job.drop['receiver_name'];
  return v is String && v.isNotEmpty ? v : 'Customer';
}

String receiverPhone(Job job) => (job.drop['receiver_phone'] ?? '').toString();

String dropAddress(Job job) => (job.drop['full_address'] ?? '').toString();

bool isCod(Job job) => job.paymentMethod == 'cod';

bool isOffer(Job job) => job.status == 'offered';
bool isActive(Job job) => job.status == 'accepted' || job.status == 'picked_up';
bool isPast(Job job) => job.status == 'delivered';

const Map<String, String> jobStatusText = {
  'offered': 'New offer',
  'accepted': 'Heading to store',
  'picked_up': 'Out for delivery',
  'delivered': 'Delivered',
  'declined': 'Declined',
  'cancelled': 'Cancelled',
  'expired': 'Expired',
};

/// External maps navigation hand-off (Google Maps directions).
Future<bool> openMapsNavigation(double lat, double lng) async {
  final uri = Uri.parse('https://www.google.com/maps/dir/?api=1&destination=$lat,$lng');
  try {
    if (await canLaunchUrl(uri)) {
      return await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  } catch (_) {
    // Fall through to failure — caller shows a friendly message.
  }
  return false;
}

Future<bool> navigateToStop(BuildContext context, Map<String, dynamic> stop) async {
  if (!hasCoords(stop)) {
    _toast(context, 'No coordinates available for this stop');
    return false;
  }
  final ok = await openMapsNavigation(_coord(stop, 'lat'), _coord(stop, 'lng'));
  if (!ok && context.mounted) _toast(context, 'Could not open maps on this device');
  return ok;
}

Future<void> callPhone(BuildContext context, String phone) async {
  final digits = phone.replaceAll(RegExp(r'\D'), '');
  if (digits.isEmpty) {
    _toast(context, 'No phone number available');
    return;
  }
  final uri = Uri.parse('tel:$digits');
  try {
    if (await canLaunchUrl(uri) && await launchUrl(uri)) return;
  } catch (_) {
    // Fall through to the friendly message below.
  }
  if (context.mounted) _toast(context, 'Could not place a call from this device');
}

void _toast(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

/// Small tinted pill used across rider cards (vehicle, COD, tips, presence).
class RiderPill extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color bg;
  final Color fg;
  const RiderPill({super.key, required this.icon, required this.label, this.bg = BB.greenTint, this.fg = BB.greenDeep});
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          Icon(icon, size: 12, color: fg),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(color: fg, fontSize: 11, fontWeight: FontWeight.w800)),
        ]),
      );
}

/// Job-status chip with rider-specific labels (web jobChip mirror).
class JobStatusChip extends StatelessWidget {
  final String status;
  const JobStatusChip({super.key, required this.status});
  @override
  Widget build(BuildContext context) {
    Color bg = BB.amberTint, fg = BB.amber;
    switch (status) {
      case 'accepted':
        bg = BB.blueTint;
        fg = BB.blue;
        break;
      case 'picked_up':
        bg = BB.blueTint;
        fg = BB.blue;
        break;
      case 'delivered':
        bg = BB.saveTint;
        fg = BB.saveInk;
        break;
      case 'declined':
      case 'cancelled':
        bg = BB.redTint;
        fg = BB.red;
        break;
      case 'expired':
        bg = BB.line;
        fg = BB.sub;
        break;
      case 'offered':
        bg = BB.amberTint;
        fg = BB.amber;
        break;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
      child: Text(jobStatusText[status] ?? status, style: TextStyle(color: fg, fontSize: 11, fontWeight: FontWeight.w800)),
    );
  }
}

/// COD / paid-online pill.
class PaymentPill extends StatelessWidget {
  final Job job;
  const PaymentPill({super.key, required this.job});
  @override
  Widget build(BuildContext context) => isCod(job)
      ? const RiderPill(icon: Icons.payments_outlined, label: 'COD', bg: BB.amberTint, fg: BB.amber)
      : const RiderPill(icon: Icons.credit_card, label: 'Paid online', bg: BB.blueTint, fg: BB.blue);
}
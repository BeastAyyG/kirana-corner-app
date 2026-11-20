import 'package:intl/intl.dart';

/// Money is integer paise everywhere; division by 100 is for display only.
String money(num? minor) {
  final v = (minor ?? 0).toInt();
  final digits = v % 100 == 0 ? 0 : 2;
  return NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: digits)
      .format(v / 100);
}

String moneyExact(num? minor) {
  return NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 2)
      .format((minor ?? 0).toInt() / 100);
}

DateTime _toIst(DateTime d) => d.toUtc().add(const Duration(hours: 5, minutes: 30));

DateTime? _parse(String? iso) {
  if (iso == null || iso.isEmpty) return null;
  return DateTime.tryParse(iso);
}

String isoDate([DateTime? date]) {
  final d = date ?? DateTime.now();
  return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

String dateLabel(String dateStr, [String? todayIso]) {
  final today = todayIso ?? isoDate();
  final from = DateTime.parse('${today}T12:00:00Z');
  final to = DateTime.parse('${dateStr}T12:00:00Z');
  final diff = to.difference(from).inDays;
  if (diff == 0) return 'Today';
  if (diff == 1) return 'Tomorrow';
  return DateFormat('EEE, d MMM', 'en_IN').format(to);
}

String timeLabel(String? iso) {
  final d = _parse(iso);
  if (d == null) return '';
  return DateFormat('h:mm a', 'en_IN').format(_toIst(d));
}

String slotRange(String? startsAt, String? endsAt) {
  String hm(String? iso) {
    final d = _parse(iso);
    if (d == null) return '';
    return DateFormat('HH:mm', 'en_GB').format(_toIst(d));
  }

  return '${hm(startsAt)}–${hm(endsAt)}';
}

String dateShort(String? iso) {
  final d = _parse(iso);
  if (d == null) return '';
  return DateFormat('EEE, d MMM', 'en_IN').format(_toIst(d));
}

String dateTime(String? iso) {
  final d = _parse(iso);
  if (d == null) return '';
  return '${dateShort(iso)} · ${timeLabel(iso)}';
}

String relativeTime(String? iso) {
  final d = _parse(iso);
  if (d == null) return '';
  final mins = DateTime.now().difference(d).inMinutes;
  if (mins < 1) return 'just now';
  if (mins < 60) return '$mins min ago';
  final hours = (mins / 60).round();
  if (hours < 24) return '$hours hr ago';
  return dateShort(iso);
}

const Map<String, String> statusTextMap = {
  'placed': 'Order placed',
  'packing': 'Being packed',
  'packed': 'Packed',
  'rider_assigned': 'Rider assigned',
  'picked_up': 'Out for delivery',
  'delivered': 'Delivered',
  'cancelled': 'Cancelled',
};

String statusText(String? status) => statusTextMap[status] ?? (status ?? '');

const List<String> statusOrder = [
  'placed', 'packing', 'packed', 'rider_assigned', 'picked_up', 'delivered',
];

const List<Map<String, String>> deliverySteps = [
  {'key': 'placed', 'label': 'Order placed', 'note': 'We have your order'},
  {'key': 'packing', 'label': 'Packing your items', 'note': 'The store is picking your basket'},
  {'key': 'packed', 'label': 'Packed & ready', 'note': 'Waiting for a rider'},
  {'key': 'rider_assigned', 'label': 'Rider assigned', 'note': 'Heading to the store'},
  {'key': 'picked_up', 'label': 'Out for delivery', 'note': 'On the way to you'},
  {'key': 'delivered', 'label': 'Delivered', 'note': 'Enjoy!'},
];

int stepIndex(String? status) {
  final i = statusOrder.indexOf(status ?? '');
  return i < 0 ? 0 : i;
}

bool isTerminal(String? status) => status == 'delivered' || status == 'cancelled';
bool isLive(String? status) => !isTerminal(status);

String prettyCode(String? code) {
  final c = (code ?? '').toUpperCase();
  return c.length == 8 ? '${c.substring(0, 4)} ${c.substring(4)}' : c;
}

String etaLabel(dynamic range) {
  if (range is List && range.length == 2) return '${range[0]}–${range[1]} min';
  return '${range ?? 0} min';
}

String distanceLabel(num? km) {
  final n = (km ?? 0).toDouble();
  return n < 1 ? '${(n * 1000).round()} m' : '${n.toStringAsFixed(1)} km';
}

String phonePretty(String? phone) {
  final c = (phone ?? '').replaceAll(RegExp(r'\D'), '');
  if (c.length == 12 && c.startsWith('91')) {
    return '+91 ${c.substring(2, 7)} ${c.substring(7)}';
  }
  return phone ?? '';
}
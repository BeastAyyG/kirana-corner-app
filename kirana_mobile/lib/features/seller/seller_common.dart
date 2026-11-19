import 'package:flutter/material.dart';

import '../../core/api/api_exception.dart';
import '../../core/models.dart';
import '../../core/theme.dart';

/// Shared helpers + small widgets for the seller (picker) module.

String errorMessage(Object e) =>
    e is ApiException ? e.message : 'Something went wrong. Please try again.';

void showSnack(BuildContext context, String message, {bool error = false}) {
  if (!context.mounted) return;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: error ? BB.red : BB.ink,
      duration: Duration(seconds: error ? 4 : 2),
    ));
}

// --- defensive JSON accessors (order items / products arrive as raw maps) ---

int intOf(dynamic v) => v is int ? v : (v is num ? v.toInt() : int.tryParse('$v') ?? 0);
int? intOrNull(dynamic v) => v == null ? null : intOf(v);
String strOf(dynamic v) => v == null ? '' : '$v';
bool boolOf(dynamic v) => v == true || v == 1 || v == '1' || v == 'true';
Map<String, dynamic> mapOf(dynamic v) =>
    v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

/// Rupees text for form prefill. Division by 100 is display/input only.
String rupeesText(num? minor) {
  final v = (minor ?? 0).toInt();
  return v % 100 == 0 ? '${v ~/ 100}' : (v / 100).toStringAsFixed(2);
}

/// Convert a rupees input string to integer paise.
int toPaise(String rupees) => ((double.tryParse(rupees.trim()) ?? 0) * 100).round();

// --- order helpers (the wire bill uses grand_total_minor / cod_due_minor) ---

int grandTotalOf(Order o) => intOf(mapOf(o.raw['bill'])['grand_total_minor']);
int codDueOf(Order o) => intOf(mapOf(o.raw['bill'])['cod_due_minor']);
int couponDiscountOf(Order o) => intOf(mapOf(o.raw['bill'])['coupon_discount_minor']);
int tipOf(Order o) => intOf(mapOf(o.raw['bill'])['tip_minor']);

/// Available units for a staff inventory row (`available` is a count, not a bool).
int availableOf(Map<String, dynamic> p) {
  if (p.containsKey('on_hand')) {
    final a = intOf(p['on_hand']) - intOf(p['reserved']);
    return a < 0 ? 0 : a;
  }
  return intOf(p['available']);
}

Future<bool> askConfirm(
  BuildContext context, {
  required String title,
  required String message,
  String confirmLabel = 'Confirm',
  bool danger = false,
}) async {
  final ok = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      backgroundColor: BB.card,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BB.radiusLg)),
      title: Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: BB.ink)),
      content: Text(message, style: const TextStyle(fontSize: 14, color: BB.sub, height: 1.4)),
      actions: [
        TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
        ElevatedButton(
          onPressed: () => Navigator.of(ctx).pop(true),
          style: ElevatedButton.styleFrom(backgroundColor: danger ? BB.red : BB.green),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return ok == true;
}

/// Small colored pill (stock levels, payment, rider state).
class Pill extends StatelessWidget {
  final String label;
  final Color color;
  final Color tint;
  final IconData? icon;
  const Pill({super.key, required this.label, required this.color, required this.tint, this.icon});

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
        decoration: BoxDecoration(color: tint, borderRadius: BorderRadius.circular(20)),
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          if (icon != null) ...[Icon(icon, size: 12, color: color), const SizedBox(width: 4)],
          Text(label, style: TextStyle(color: color, fontSize: 11, fontWeight: FontWeight.w800)),
        ]),
      );
}

/// Compact − value + stepper that always shows the number (unlike QtyStepper,
/// which renders an ADD button at zero — wrong for picks/stock at 0).
class CountStepper extends StatelessWidget {
  final int value;
  final int min;
  final int max;
  final ValueChanged<int> onChanged;
  final bool busy;
  const CountStepper({
    super.key,
    required this.value,
    required this.onChanged,
    this.min = 0,
    this.max = 99999,
    this.busy = false,
  });

  @override
  Widget build(BuildContext context) {
    Widget btn(IconData icon, bool enabled, VoidCallback onTap) => InkWell(
          onTap: enabled && !busy ? onTap : null,
          child: SizedBox(
            width: 30,
            height: 30,
            child: Icon(icon, size: 16, color: enabled && !busy ? Colors.white : Colors.white54),
          ),
        );
    return Container(
      height: 30,
      decoration: BoxDecoration(color: BB.green, borderRadius: BorderRadius.circular(8)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        btn(Icons.remove, value > min, () => onChanged(value - 1)),
        SizedBox(
          width: 30,
          child: busy
              ? const Padding(
                  padding: EdgeInsets.all(7),
                  child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2),
                )
              : Text('$value', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 13)),
        ),
        btn(Icons.add, value < max, () => onChanged(value + 1)),
      ]),
    );
  }
}

/// A switch row used in settings.
class ToggleRow extends StatelessWidget {
  final String title;
  final String subtitle;
  final bool value;
  final bool busy;
  final ValueChanged<bool> onChanged;
  const ToggleRow({
    super.key,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
    this.busy = false,
  });

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: BB.ink)),
              const SizedBox(height: 2),
              Text(subtitle, style: const TextStyle(fontSize: 12, color: BB.sub)),
            ]),
          ),
          Switch(
            value: value,
            activeColor: BB.green,
            onChanged: busy ? null : onChanged,
          ),
        ]),
      );
}

/// KPI tile for the metrics dashboard.
class StatCard extends StatelessWidget {
  final String label;
  final String value;
  final String note;
  final Color noteColor;
  final VoidCallback? onTap;
  const StatCard({
    super.key,
    required this.label,
    required this.value,
    this.note = '',
    this.noteColor = BB.sub,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) => Material(
        color: BB.card,
        borderRadius: BorderRadius.circular(BB.radius),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(BB.radius),
          child: Container(
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(BB.radius), border: Border.all(color: BB.line)),
            padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(label, style: const TextStyle(fontSize: 12, color: BB.sub, fontWeight: FontWeight.w600)),
              const SizedBox(height: 6),
              FittedBox(
                fit: BoxFit.scaleDown,
                child: Text(value, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: BB.ink)),
              ),
              if (note.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(note, style: TextStyle(fontSize: 11, color: noteColor, fontWeight: FontWeight.w600)),
              ],
            ]),
          ),
        ),
      );
}
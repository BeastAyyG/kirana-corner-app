// Small shared building blocks for the admin screens: pills, headings,
// dialogs, snackbars and rupee→paise conversion.
import 'package:flutter/material.dart';
import '../../core/api/api_exception.dart';
import '../../core/theme.dart';

String adminErrorMessage(Object error, [String fallback = 'Something went wrong. Please try again.']) {
  if (error is ApiException) return error.message;
  return fallback;
}

void showAdminSnack(BuildContext context, String message, {bool isError = false}) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: isError ? BB.red : BB.ink,
    ));
}

Future<bool> confirmAction(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  bool danger = false,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (ctx) => AlertDialog(
      backgroundColor: BB.card,
      title: Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: BB.ink)),
      content: Text(message, style: const TextStyle(fontSize: 14, color: BB.sub, height: 1.4)),
      actions: [
        TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Keep it')),
        TextButton(
          onPressed: () => Navigator.of(ctx).pop(true),
          style: TextButton.styleFrom(foregroundColor: danger ? BB.red : BB.greenDark),
          child: Text(confirmLabel, style: const TextStyle(fontWeight: FontWeight.w800)),
        ),
      ],
    ),
  );
  return result == true;
}

/// Rupees text → integer paise. Returns null when the input is not a valid
/// non-negative amount.
int? rupeesToPaise(String input) {
  final n = double.tryParse(input.trim());
  if (n == null || !n.isFinite || n < 0) return null;
  return (n * 100).round();
}

class Pill extends StatelessWidget {
  final String label;
  final Color bg;
  final Color fg;
  const Pill({super.key, required this.label, this.bg = BB.greenTint, this.fg = BB.greenDeep});
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
        child: Text(label, style: TextStyle(color: fg, fontSize: 10.5, fontWeight: FontWeight.w800)),
      );
}

/// Page heading inside a tab: title, subtitle and trailing action buttons.
class AdminHeading extends StatelessWidget {
  final String title;
  final String subtitle;
  final List<Widget> actions;
  const AdminHeading({super.key, required this.title, this.subtitle = '', this.actions = const []});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 12, 6),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: BB.ink)),
              if (subtitle.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(subtitle, style: const TextStyle(fontSize: 12, color: BB.sub)),
                ),
            ]),
          ),
          ...actions,
        ]),
      );
}

class RefreshAction extends StatelessWidget {
  final VoidCallback onPressed;
  const RefreshAction({super.key, required this.onPressed});
  @override
  Widget build(BuildContext context) => IconButton(
        onPressed: onPressed,
        icon: const Icon(Icons.refresh_rounded, color: BB.greenDark),
        tooltip: 'Refresh',
      );
}

/// A labelled full-width form field used by every admin form.
class AdminField extends StatelessWidget {
  final String label;
  final Widget child;
  final String hint;
  const AdminField({super.key, required this.label, required this.child, this.hint = ''});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(label, style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: BB.ink)),
          const SizedBox(height: 6),
          child,
          if (hint.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(hint, style: const TextStyle(fontSize: 11, color: BB.faint)),
            ),
        ]),
      );
}

/// Horizontal filter chip used by orders / users toolbars.
class FilterChipButton extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;
  const FilterChipButton({super.key, required this.label, required this.selected, required this.onTap});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(right: 8),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(20),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
            decoration: BoxDecoration(
              color: selected ? BB.green : BB.card,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: selected ? BB.green : BB.line),
            ),
            child: Text(label,
                style: TextStyle(
                    fontSize: 12.5, fontWeight: FontWeight.w700, color: selected ? Colors.white : BB.sub)),
          ),
        ),
      );
}

/// Search box shared by the list screens.
class AdminSearchBox extends StatelessWidget {
  final TextEditingController controller;
  final String placeholder;
  final ValueChanged<String> onChanged;
  const AdminSearchBox({super.key, required this.controller, required this.placeholder, required this.onChanged});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 6, 16, 8),
        child: TextField(
          controller: controller,
          onChanged: onChanged,
          style: const TextStyle(fontSize: 14, color: BB.ink),
          decoration: InputDecoration(
            hintText: placeholder,
            prefixIcon: const Icon(Icons.search_rounded, color: BB.faint, size: 20),
            isDense: true,
            suffixIcon: controller.text.isEmpty
                ? null
                : IconButton(
                    icon: const Icon(Icons.close_rounded, size: 18, color: BB.faint),
                    onPressed: () {
                      controller.clear();
                      onChanged('');
                    },
                  ),
          ),
        ),
      );
}
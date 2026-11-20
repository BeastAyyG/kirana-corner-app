import 'package:flutter/material.dart';
import 'art.dart';
import 'format.dart';
import 'models.dart';
import 'theme.dart';

class LoadingView extends StatelessWidget {
  const LoadingView({super.key});
  @override
  Widget build(BuildContext context) =>
      const Center(child: Padding(padding: EdgeInsets.all(32), child: CircularProgressIndicator(color: BB.green)));
}

class ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback? onRetry;
  const ErrorView({super.key, required this.message, this.onRetry});
  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.cloud_off_rounded, size: 48, color: BB.faint),
            const SizedBox(height: 12),
            Text(message, textAlign: TextAlign.center, style: const TextStyle(color: BB.sub, fontSize: 14)),
            if (onRetry != null) ...[
              const SizedBox(height: 16),
              OutlinedButton(onPressed: onRetry, child: const Text('Try again')),
            ],
          ]),
        ),
      );
}

class EmptyState extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final Widget? action;
  const EmptyState({super.key, required this.icon, required this.title, this.subtitle = '', this.action});
  @override
  Widget build(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: const BoxDecoration(color: BB.greenTint, shape: BoxShape.circle),
              child: Icon(icon, size: 40, color: BB.greenDark),
            ),
            const SizedBox(height: 16),
            Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: BB.ink)),
            if (subtitle.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(subtitle, textAlign: TextAlign.center, style: const TextStyle(color: BB.sub, fontSize: 13)),
            ],
            if (action != null) ...[const SizedBox(height: 18), action!],
          ]),
        ),
      );
}

class SectionHeader extends StatelessWidget {
  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;
  const SectionHeader({super.key, required this.title, this.actionLabel, this.onAction});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 18, 12, 8),
        child: Row(children: [
          Expanded(child: Text(title, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: BB.ink))),
          if (actionLabel != null)
            TextButton(onPressed: onAction, child: Text(actionLabel!, style: const TextStyle(color: BB.greenDark, fontWeight: FontWeight.w700))),
        ]),
      );
}

/// BigBasket-style green ADD button that morphs into a − qty + stepper.
class QtyStepper extends StatelessWidget {
  final int quantity;
  final ValueChanged<int> onChanged;
  final int min;
  final int max;
  final bool compact;
  const QtyStepper({super.key, required this.quantity, required this.onChanged, this.min = 0, this.max = 99, this.compact = false});

  @override
  Widget build(BuildContext context) {
    final h = compact ? 30.0 : 34.0;
    if (quantity <= 0) {
      return SizedBox(
        height: h,
        child: OutlinedButton(
          onPressed: () => onChanged(1),
          style: OutlinedButton.styleFrom(
            foregroundColor: BB.greenDark,
            side: const BorderSide(color: BB.green),
            backgroundColor: BB.greenTint,
            padding: EdgeInsets.symmetric(horizontal: compact ? 14 : 20),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            textStyle: TextStyle(fontWeight: FontWeight.w800, fontSize: compact ? 12 : 13),
          ),
          child: const Text('ADD'),
        ),
      );
    }
    return Container(
      height: h,
      decoration: BoxDecoration(color: BB.green, borderRadius: BorderRadius.circular(8)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        _btn(Icons.remove, () => onChanged(quantity - 1 < min ? min : quantity - 1)),
        SizedBox(width: compact ? 22 : 28, child: Text('$quantity', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w800, fontSize: 14))),
        _btn(Icons.add, () => onChanged(quantity + 1 > max ? max : quantity + 1)),
      ]),
    );
  }

  Widget _btn(IconData icon, VoidCallback onTap) => InkWell(
        onTap: onTap,
        child: SizedBox(width: compact ? 28 : 32, height: double.infinity, child: Icon(icon, color: Colors.white, size: compact ? 16 : 18)),
      );
}

class PriceRow extends StatelessWidget {
  final int priceMinor;
  final int mrpMinor;
  final double fontSize;
  const PriceRow({super.key, required this.priceMinor, this.mrpMinor = 0, this.fontSize = 14});
  @override
  Widget build(BuildContext context) {
    final showMrp = mrpMinor > priceMinor;
    return Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
      Text(money(priceMinor), style: TextStyle(fontWeight: FontWeight.w800, fontSize: fontSize, color: BB.ink)),
      if (showMrp) ...[
        const SizedBox(width: 5),
        Padding(
          padding: const EdgeInsets.only(bottom: 1),
          child: Text(money(mrpMinor), style: TextStyle(decoration: TextDecoration.lineThrough, color: BB.faint, fontSize: fontSize - 2)),
        ),
      ],
    ]);
  }
}

class ProductCard extends StatelessWidget {
  final Product product;
  final int quantity;
  final ValueChanged<int> onQuantity;
  final VoidCallback? onTap;
  const ProductCard({super.key, required this.product, this.quantity = 0, required this.onQuantity, this.onTap});

  @override
  Widget build(BuildContext context) {
    final p = product;
    final hasDiscount = p.discountPercent > 0 && p.mrpMinor > p.priceMinor;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(BB.radius),
      child: Container(
        decoration: BoxDecoration(color: BB.card, borderRadius: BorderRadius.circular(BB.radius), border: Border.all(color: BB.line)),
        padding: const EdgeInsets.all(10),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Stack(children: [
            AspectRatio(
              aspectRatio: 1,
              child: ClipRRect(borderRadius: BorderRadius.circular(8), child: ArtImage(url: productArtUrl(p.artItem), categoryId: p.categoryId, fit: BoxFit.contain)),
            ),
            if (hasDiscount)
              Positioned(
                left: 0, top: 0,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
                  decoration: BoxDecoration(color: BB.blue, borderRadius: BorderRadius.circular(4)),
                  child: Text('${p.discountPercent}% OFF', style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.w800)),
                ),
              ),
          ]),
          const SizedBox(height: 8),
          Text(p.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: BB.ink, height: 1.2)),
          const SizedBox(height: 2),
          Text(p.unit, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11, color: BB.sub)),
          const Spacer(),
          const SizedBox(height: 6),
          Row(children: [
            Expanded(child: PriceRow(priceMinor: p.priceMinor, mrpMinor: p.mrpMinor, fontSize: 13)),
          ]),
          const SizedBox(height: 6),
          Align(
            alignment: Alignment.centerRight,
            child: p.available
                ? QtyStepper(quantity: quantity, onChanged: onQuantity, max: p.maxPerOrder > 0 ? p.maxPerOrder : 99, compact: true)
                : const Text('Out of stock', style: TextStyle(color: BB.red, fontSize: 11, fontWeight: FontWeight.w700)),
          ),
        ]),
      ),
    );
  }
}

class StatusChip extends StatelessWidget {
  final String status;
  const StatusChip({super.key, required this.status});
  @override
  Widget build(BuildContext context) {
    Color bg = BB.greenTint, fg = BB.greenDeep;
    if (status == 'cancelled') { bg = BB.redTint; fg = BB.red; }
    else if (status == 'delivered') { bg = BB.saveTint; fg = BB.saveInk; }
    else if (status == 'picked_up' || status == 'rider_assigned') { bg = BB.blueTint; fg = BB.blue; }
    else if (status == 'packing' || status == 'packed') { bg = BB.amberTint; fg = BB.amber; }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(20)),
      child: Text(statusText(status), style: TextStyle(color: fg, fontSize: 11, fontWeight: FontWeight.w800)),
    );
  }
}

class PrimaryButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final IconData? icon;
  const PrimaryButton({super.key, required this.label, this.onPressed, this.loading = false, this.icon});
  @override
  Widget build(BuildContext context) => SizedBox(
        width: double.infinity,
        height: 50,
        child: ElevatedButton(
          onPressed: loading ? null : onPressed,
          style: ElevatedButton.styleFrom(
            backgroundColor: BB.green, foregroundColor: Colors.white, disabledBackgroundColor: BB.green.withValues(alpha: .6),
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BB.radius)),
            textStyle: const TextStyle(fontWeight: FontWeight.w800, fontSize: 15),
          ),
          child: loading
              ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2.4))
              : Row(mainAxisAlignment: MainAxisAlignment.center, children: [
                  if (icon != null) ...[Icon(icon, size: 19), const SizedBox(width: 8)],
                  Text(label),
                ]),
        ),
      );
}

class InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final bool bold;
  final Color? valueColor;
  const InfoRow({super.key, required this.label, required this.value, this.bold = false, this.valueColor});
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 4),
        child: Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text(label, style: TextStyle(color: bold ? BB.ink : BB.sub, fontSize: 13, fontWeight: bold ? FontWeight.w800 : FontWeight.w500)),
          Text(value, style: TextStyle(color: valueColor ?? (bold ? BB.ink : BB.ink), fontSize: 13, fontWeight: bold ? FontWeight.w800 : FontWeight.w600)),
        ]),
      );
}

/// A white rounded card container used across modules.
class AppCard extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;
  final VoidCallback? onTap;
  const AppCard({super.key, required this.child, this.padding = const EdgeInsets.all(14), this.onTap});
  @override
  Widget build(BuildContext context) => Material(
        color: BB.card,
        borderRadius: BorderRadius.circular(BB.radius),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(BB.radius),
          child: Container(
            decoration: BoxDecoration(borderRadius: BorderRadius.circular(BB.radius), border: Border.all(color: BB.line)),
            padding: padding,
            child: child,
          ),
        ),
      );
}
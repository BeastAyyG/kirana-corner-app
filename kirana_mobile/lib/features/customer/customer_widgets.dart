import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_exception.dart';
import '../../core/art.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'addresses_screen.dart';
import 'customer_data.dart';
import 'customer_providers.dart';
import 'saved_screen.dart';

void showSnack(BuildContext context, String message, {bool error = false}) {
  if (!context.mounted) return;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: error ? BB.red : BB.ink,
      duration: const Duration(seconds: 3),
    ));
}

/// Add/set a basket quantity with store-conflict recovery and error toasts.
Future<void> updateCartQty(BuildContext context, WidgetRef ref, String productId, int quantity) async {
  final storeId = ref.read(selectedStoreProvider)?.id ?? ref.read(cartProvider)?.storeId ?? '';
  if (storeId.isEmpty) {
    showSnack(context, 'Select a store first', error: true);
    return;
  }
  final notifier = ref.read(cartProvider.notifier);
  try {
    await notifier.setQty(storeId, productId, quantity);
  } on ApiException catch (e) {
    if (e.code == 'CART_STORE_CONFLICT' && context.mounted) {
      final clear = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Start a new basket?'),
          content: const Text('Your basket has items from another store. Clear it and add this item?'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep basket')),
            TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Clear & add')),
          ],
        ),
      );
      if (clear == true) {
        try {
          await notifier.clear();
          await notifier.setQty(storeId, productId, quantity);
        } on ApiException catch (e2) {
          if (context.mounted) showSnack(context, e2.message, error: true);
        }
      }
    } else {
      if (context.mounted) showSnack(context, e.message, error: true);
    }
  }
}

/// Quick-commerce shopper header: ETA + delivery address, profile, search
/// pill and saved-items shortcut.
class CustomerHeader extends ConsumerWidget {
  const CustomerHeader({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final info = ref.watch(serviceInfoProvider);
    final addr = ref.watch(selectedAddressProvider);
    final savedCount = ref.watch(savedProvider)?.length ?? 0;
    final etaText = (info != null && info.serviceable && info.promise.isNotEmpty)
        ? info.promise
        : 'Set delivery location';
    final addrText = addr == null
        ? 'Add a delivery address'
        : (addr.label.isNotEmpty ? '${addr.label} · ${addr.line1}' : addr.line1);

    return Container(
      color: BB.headerTint,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 8, 12),
          child: Column(children: [
            Row(children: [
              Expanded(
                child: InkWell(
                  onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AddressesScreen())),
                  borderRadius: BorderRadius.circular(8),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      const Icon(Icons.bolt_rounded, color: BB.greenDark, size: 19),
                      const SizedBox(width: 3),
                      Expanded(child: Text(etaText, maxLines: 1, overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800, color: BB.ink))),
                    ]),
                    const SizedBox(height: 2),
                    Row(children: [
                      const Icon(Icons.location_on_outlined, color: BB.sub, size: 14),
                      const SizedBox(width: 3),
                      Expanded(child: Text(addrText, maxLines: 1, overflow: TextOverflow.ellipsis,
                          style: const TextStyle(fontSize: 12, color: BB.sub))),
                      const Icon(Icons.expand_more_rounded, color: BB.sub, size: 16),
                    ]),
                  ]),
                ),
              ),
              IconButton(
                tooltip: 'Your account',
                onPressed: () => ref.read(customerTabProvider.notifier).state = 4,
                icon: Container(
                  padding: const EdgeInsets.all(7),
                  decoration: const BoxDecoration(color: BB.card, shape: BoxShape.circle),
                  child: const Icon(Icons.person_outline_rounded, size: 20, color: BB.greenDeep),
                ),
              ),
            ]),
            const SizedBox(height: 8),
            Row(children: [
              Expanded(
                child: InkWell(
                  onTap: () {
                    ref.read(customerTabProvider.notifier).state = 1;
                    ref.read(browseSearchFocusProvider.notifier).state++;
                  },
                  borderRadius: BorderRadius.circular(24),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                    decoration: BoxDecoration(
                      color: BB.card, borderRadius: BorderRadius.circular(24),
                      border: Border.all(color: BB.line),
                    ),
                    child: const Row(children: [
                      Icon(Icons.search_rounded, size: 19, color: BB.sub),
                      SizedBox(width: 8),
                      Expanded(child: Text('Search "milk", "atta", "snacks"…',
                          maxLines: 1, overflow: TextOverflow.ellipsis,
                          style: TextStyle(fontSize: 13, color: BB.faint))),
                    ]),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              InkWell(
                onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SavedScreen())),
                borderRadius: BorderRadius.circular(24),
                child: Container(
                  padding: const EdgeInsets.all(10),
                  decoration: BoxDecoration(color: BB.card, borderRadius: BorderRadius.circular(24), border: Border.all(color: BB.line)),
                  child: Badge(
                    isLabelVisible: savedCount > 0,
                    label: Text('$savedCount'),
                    backgroundColor: BB.green,
                    child: const Icon(Icons.favorite_border_rounded, size: 20, color: BB.greenDeep),
                  ),
                ),
              ),
            ]),
          ]),
        ),
      ),
    );
  }
}

/// Thin green assurance strip ("Delivery in X min from Store").
class GreenStrip extends StatelessWidget {
  final IconData icon;
  final String text;
  const GreenStrip({super.key, required this.icon, required this.text});
  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.fromLTRB(16, 10, 16, 0),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(color: BB.greenTint, borderRadius: BorderRadius.circular(10)),
        child: Row(children: [
          Icon(icon, size: 16, color: BB.greenDark),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: BB.greenDeep))),
        ]),
      );
}

/// Bill details card mirroring the web bill (item total, savings, fees,
/// coupon, tip, to-pay and total savings).
class BillCard extends StatelessWidget {
  final BillView bill;
  const BillCard({super.key, required this.bill});

  @override
  Widget build(BuildContext context) {
    final b = bill;
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        const Row(children: [
          Icon(Icons.receipt_long_outlined, size: 17, color: BB.ink),
          SizedBox(width: 7),
          Text('Bill details', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
        ]),
        const SizedBox(height: 8),
        InfoRow(label: 'Item total', value: moneyExact(b.itemsTotalMinor)),
        if (b.savingsMinor > 0)
          InfoRow(label: 'Product savings', value: '− ${moneyExact(b.savingsMinor)}', valueColor: BB.saveInk),
        InfoRow(
          label: 'Delivery fee',
          value: b.deliveryFeeWaived ? 'FREE' : moneyExact(b.deliveryFeeMinor),
          valueColor: b.deliveryFeeWaived ? BB.saveInk : null,
        ),
        if (!b.deliveryFeeWaived && b.amountToFreeDeliveryMinor > 0)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Text('Add ${money(b.amountToFreeDeliveryMinor)} more for free delivery',
                style: const TextStyle(fontSize: 11.5, color: BB.greenDark, fontWeight: FontWeight.w600)),
          ),
        if (b.handlingFeeMinor > 0) InfoRow(label: 'Handling fee', value: moneyExact(b.handlingFeeMinor)),
        if (b.surgeFeeMinor > 0)
          InfoRow(label: 'Surge fee', value: moneyExact(b.surgeFeeMinor), valueColor: BB.amber),
        if (b.couponDiscountMinor > 0)
          InfoRow(
            label: 'Coupon${b.couponCode.isNotEmpty ? ' (${b.couponCode})' : ''}',
            value: '− ${moneyExact(b.couponDiscountMinor)}',
            valueColor: BB.saveInk,
          ),
        if (b.tipMinor > 0) InfoRow(label: 'Rider tip', value: moneyExact(b.tipMinor)),
        const Divider(height: 18),
        InfoRow(label: 'To pay', value: moneyExact(b.grandTotalMinor), bold: true),
        if (b.totalSavingsMinor > 0) ...[
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
            decoration: BoxDecoration(color: BB.saveTint, borderRadius: BorderRadius.circular(8)),
            child: Row(children: [
              const Icon(Icons.sell_outlined, size: 14, color: BB.saveInk),
              const SizedBox(width: 6),
              Text('You save ${moneyExact(b.totalSavingsMinor)} on this order',
                  style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: BB.saveInk)),
            ]),
          ),
        ],
      ]),
    );
  }
}

/// Horizontal product rail used on Home and PDP.
class ProductRail extends ConsumerWidget {
  final String title;
  final List<Product> products;
  final VoidCallback? onSeeAll;
  final void Function(Product product) onTap;
  const ProductRail({super.key, required this.title, required this.products, this.onSeeAll, required this.onTap});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (products.isEmpty) return const SizedBox.shrink();
    final cart = ref.watch(cartProvider);
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      SectionHeader(title: title, actionLabel: onSeeAll != null ? 'See all' : null, onAction: onSeeAll),
      SizedBox(
        height: 272,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: 16),
          itemCount: products.length,
          separatorBuilder: (_, __) => const SizedBox(width: 10),
          itemBuilder: (context, i) {
            final p = products[i];
            return SizedBox(
              width: 158,
              child: ProductCard(
                product: p,
                quantity: cartQtyOf(cart, p.id),
                onQuantity: (q) => updateCartQty(context, ref, p.id, q),
                onTap: () => onTap(p),
              ),
            );
          },
        ),
      ),
    ]);
  }
}

/// Address card with selection state; used in checkout and address manager.
class AddressCard extends StatelessWidget {
  final Address address;
  final bool selected;
  final VoidCallback? onTap;
  final Widget? trailing;
  const AddressCard({super.key, required this.address, this.selected = false, this.onTap, this.trailing});

  @override
  Widget build(BuildContext context) {
    final a = address;
    return AppCard(
      onTap: onTap,
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Icon(a.label.toLowerCase() == 'work' ? Icons.storefront_outlined : Icons.home_outlined,
            size: 20, color: selected ? BB.greenDark : BB.sub),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Flexible(child: Text(a.label.isEmpty ? 'Address' : a.label,
                  style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w800, color: BB.ink))),
              if (a.isDefault) ...[
                const SizedBox(width: 6),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(color: BB.greenTint, borderRadius: BorderRadius.circular(10)),
                  child: const Text('Default', style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w700, color: BB.greenDeep)),
                ),
              ],
            ]),
            const SizedBox(height: 3),
            Text(a.full, style: const TextStyle(fontSize: 12, color: BB.sub, height: 1.35)),
            if (a.receiverName.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text('${a.receiverName} · ${phonePretty(a.receiverPhone)}',
                  style: const TextStyle(fontSize: 11.5, color: BB.faint)),
            ],
            if (trailing != null) ...[const SizedBox(height: 8), trailing!],
          ]),
        ),
        if (selected) const Icon(Icons.check_circle_rounded, size: 20, color: BB.green),
      ]),
    );
  }
}

/// Today / tomorrow / day-after slot picker backed by the real slots API.
class SlotPicker extends ConsumerStatefulWidget {
  final String storeId;
  final String selectedSlotId;
  final ValueChanged<SlotView> onSelected;
  const SlotPicker({super.key, required this.storeId, required this.selectedSlotId, required this.onSelected});

  @override
  ConsumerState<SlotPicker> createState() => _SlotPickerState();
}

class _SlotPickerState extends ConsumerState<SlotPicker> {
  int _dayOffset = 0;
  List<SlotView>? _slots;
  bool _loading = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  String get _date => isoDate(DateTime.now().add(Duration(days: _dayOffset)));

  Future<void> _load() async {
    setState(() { _loading = true; _error = ''; });
    try {
      final res = await ref.read(apiProvider).slots(widget.storeId, _date);
      final slots = listFrom(res, 'slots').map(SlotView.fromJson).toList();
      if (!mounted) return;
      setState(() { _slots = slots; _loading = false; });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() { _slots = const []; _loading = false; _error = e.message; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final slots = _slots;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        for (var i = 0; i < 3; i++) ...[
          Expanded(child: _dateButton(i)),
          if (i < 2) const SizedBox(width: 8),
        ],
      ]),
      const SizedBox(height: 10),
      if (_loading)
        const Padding(padding: EdgeInsets.all(14), child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4))))
      else if (_error.isNotEmpty)
        Text(_error, style: const TextStyle(fontSize: 12, color: BB.red))
      else if (slots == null || slots.isEmpty)
        const Text('No slots left for this day. Try another date.', style: TextStyle(fontSize: 12, color: BB.sub))
      else
        Wrap(spacing: 8, runSpacing: 8, children: [
          for (final s in slots) _slotChip(s),
        ]),
    ]);
  }

  Widget _dateButton(int offset) {
    final date = isoDate(DateTime.now().add(Duration(days: offset)));
    final on = offset == _dayOffset;
    return InkWell(
      onTap: () {
        if (_dayOffset == offset) return;
        setState(() => _dayOffset = offset);
        _load();
      },
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 9),
        decoration: BoxDecoration(
          color: on ? BB.greenTint : BB.card,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: on ? BB.green : BB.line),
        ),
        child: Column(children: [
          Text(dateLabel(date), style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: on ? BB.greenDeep : BB.ink)),
          Text(date.length >= 10 ? '${date.substring(8)}/${date.substring(5, 7)}' : '', style: const TextStyle(fontSize: 10, color: BB.sub)),
        ]),
      ),
    );
  }

  Widget _slotChip(SlotView s) {
    final on = s.id == widget.selectedSlotId;
    final enabled = s.bookable;
    return InkWell(
      onTap: enabled ? () => widget.onSelected(s) : null,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        width: 104,
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          color: on ? BB.green : BB.card,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: on ? BB.green : BB.line),
        ),
        child: Column(children: [
          Text(slotRange(s.startsAt, s.endsAt),
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: on ? Colors.white : (enabled ? BB.ink : BB.faint))),
          Text(enabled ? '${s.remaining} left' : 'Full',
              style: TextStyle(fontSize: 10, color: on ? Colors.white : BB.sub)),
        ]),
      ),
    );
  }
}

/// Coupons & offers bottom sheet: apply a listed offer or type a code.
Future<void> showCouponSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: BB.card,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(BB.radiusLg))),
    builder: (_) => const _CouponSheet(),
  );
}

class _CouponSheet extends ConsumerStatefulWidget {
  const _CouponSheet();
  @override
  ConsumerState<_CouponSheet> createState() => _CouponSheetState();
}

class _CouponSheetState extends ConsumerState<_CouponSheet> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _apply(String code) {
    final c = code.trim().toUpperCase();
    if (c.isEmpty) return;
    ref.read(checkoutDraftProvider.notifier).state = ref.read(checkoutDraftProvider).copyWith(couponCode: c);
    Navigator.pop(context);
    showSnack(context, '$c applied');
  }

  @override
  Widget build(BuildContext context) {
    final coupons = ref.watch(couponsProvider);
    final draft = ref.watch(checkoutDraftProvider);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 12, 16, MediaQuery.of(context).viewInsets.bottom + 16),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Center(child: Container(width: 40, height: 4, decoration: BoxDecoration(color: BB.line, borderRadius: BorderRadius.circular(2)))),
          const SizedBox(height: 14),
          const Text('Coupons & offers', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: BB.ink)),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(
              child: TextField(
                controller: _controller,
                textCapitalization: TextCapitalization.characters,
                decoration: const InputDecoration(hintText: 'Enter coupon code'),
                onSubmitted: _apply,
              ),
            ),
            const SizedBox(width: 8),
            ElevatedButton(onPressed: () => _apply(_controller.text), child: const Text('Apply')),
          ]),
          if (draft.couponCode.isNotEmpty) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () {
                  ref.read(checkoutDraftProvider.notifier).state = draft.copyWith(couponCode: '');
                  Navigator.pop(context);
                },
                icon: const Icon(Icons.close_rounded, size: 16, color: BB.red),
                label: Text('Remove ${draft.couponCode}', style: const TextStyle(color: BB.red, fontSize: 13)),
              ),
            ),
          ],
          const SizedBox(height: 8),
          Flexible(
            child: coupons.when(
              loading: () => const LoadingView(),
              error: (e, _) => Text('$e', style: const TextStyle(color: BB.sub, fontSize: 13)),
              data: (list) => list.isEmpty
                  ? const Padding(padding: EdgeInsets.all(12), child: Text('No coupons available right now.', style: TextStyle(color: BB.sub, fontSize: 13)))
                  : ListView.separated(
                      shrinkWrap: true,
                      itemCount: list.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 10),
                      itemBuilder: (context, i) {
                        final c = list[i];
                        final applied = c.code == draft.couponCode;
                        return Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: applied ? BB.greenTint : BB.card,
                            borderRadius: BorderRadius.circular(BB.radius),
                            border: Border.all(color: applied ? BB.green : BB.line),
                          ),
                          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            Row(children: [
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(color: BB.headerTint, borderRadius: BorderRadius.circular(6)),
                                child: Text(c.code, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: BB.greenDeep)),
                              ),
                              const Spacer(),
                              TextButton(
                                onPressed: applied ? null : () => _apply(c.code),
                                child: Text(applied ? 'Applied ✓' : 'Apply',
                                    style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: applied ? BB.saveInk : BB.greenDark)),
                              ),
                            ]),
                            if (c.description.isNotEmpty)
                              Text(c.description, style: const TextStyle(fontSize: 12.5, color: BB.ink)),
                            const SizedBox(height: 2),
                            Text(c.minOrderMinor > 0 ? 'Min order ${money(c.minOrderMinor)}' : 'No minimum order',
                                style: const TextStyle(fontSize: 11, color: BB.faint)),
                          ]),
                        );
                      },
                    ),
            ),
          ),
        ]),
      ),
    );
  }
}

/// Small art thumbnail for cart / order line items.
class LineArt extends StatelessWidget {
  final String productId, imageUrl, categoryId;
  final double size;
  const LineArt({super.key, required this.productId, this.imageUrl = '', this.categoryId = '', this.size = 52});
  @override
  Widget build(BuildContext context) => ArtImage(
        url: productArtUrl({'id': productId, 'image_url': imageUrl, 'category_id': categoryId}),
        categoryId: categoryId,
        width: size, height: size, fit: BoxFit.contain,
        borderRadius: BorderRadius.circular(8),
      );
}
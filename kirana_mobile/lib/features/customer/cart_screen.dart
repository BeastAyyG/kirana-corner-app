import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_exception.dart';
import '../../core/format.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'addresses_screen.dart';
import 'checkout_screen.dart';
import 'customer_data.dart';
import 'customer_providers.dart';
import 'customer_widgets.dart';

/// Basket: line items with steppers, Now/Later delivery + slot picker, coupon
/// entry, live quote bill, minimum-order hint and checkout CTA.
class CartScreen extends ConsumerStatefulWidget {
  const CartScreen({super.key});

  @override
  ConsumerState<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends ConsumerState<CartScreen> {
  BillView? _quote;
  String _quoteError = '';
  int _quoteSeq = 0;

  @override
  void initState() {
    super.initState();
    _refreshCart();
  }

  Future<void> _refreshCart() async {
    try {
      await ref.read(cartProvider.notifier).refresh();
    } on ApiException catch (e) {
      if (mounted && ref.read(cartProvider) == null) showSnack(context, e.message, error: true);
    }
    _refreshQuote();
  }

  Future<void> _refreshQuote() async {
    final cart = ref.read(cartProvider);
    final addr = ref.read(selectedAddressProvider);
    if (cart == null || cart.isEmpty || addr == null) {
      if (mounted) setState(() { _quote = null; _quoteError = ''; });
      return;
    }
    final draft = ref.read(checkoutDraftProvider);
    final seq = ++_quoteSeq;
    try {
      final res = await ref.read(apiProvider).quote({
        'address_id': addr.id,
        'coupon_code': draft.couponCode,
        'delivery_type': draft.deliveryType,
        'tip_minor': 0,
      });
      if (!mounted || seq != _quoteSeq) return;
      final bill = BillView.fromJson(mapFrom(mapFrom(res, 'quote'), 'bill'));
      setState(() { _quote = bill; _quoteError = ''; });
    } on ApiException catch (e) {
      if (!mounted || seq != _quoteSeq) return;
      setState(() { _quote = null; _quoteError = e.message; });
    }
  }

  Future<void> _clearCart() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Empty your basket?'),
        content: const Text('All items will be removed.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Keep items')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Empty basket', style: TextStyle(color: BB.red))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(cartProvider.notifier).clear();
      if (mounted) showSnack(context, 'Basket emptied');
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
  }

  void _checkout() {
    if (ref.read(selectedAddressProvider) == null) {
      showSnack(context, 'Add a delivery address first', error: true);
      Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AddressesScreen()));
      return;
    }
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CheckoutScreen()));
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(cartProvider, (_, __) => _refreshQuote());
    ref.listen(checkoutDraftProvider, (_, __) => _refreshQuote());
    ref.listen(selectedAddressProvider, (_, __) => _refreshQuote());
    ref.listen(customerTabProvider, (_, tab) {
      if (tab == 2) _refreshCart();
    });

    final cart = ref.watch(cartProvider);
    final store = ref.watch(selectedStoreProvider);
    final addr = ref.watch(selectedAddressProvider);
    final draft = ref.watch(checkoutDraftProvider);
    final coupons = ref.watch(couponsProvider).value ?? const <Coupon>[];
    final info = ref.watch(serviceInfoProvider);
    final eta = info?.serviceable == true ? info!.etaMinutes : 15;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Your basket'),
        actions: [
          if (cart != null && !cart.isEmpty)
            IconButton(tooltip: 'Empty basket', onPressed: _clearCart, icon: const Icon(Icons.delete_outline_rounded, color: BB.sub)),
        ],
      ),
      body: cart == null
          ? const LoadingView()
          : cart.isEmpty
              ? EmptyState(
                  icon: Icons.shopping_basket_outlined,
                  title: 'Your basket is empty',
                  subtitle: 'Add fresh groceries and they will show up here.',
                  action: PrimaryButton(
                    label: 'Start shopping',
                    onPressed: () => ref.read(customerTabProvider.notifier).state = 1,
                  ),
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                  children: [
                    if (store != null)
                      GreenStrip(icon: Icons.bolt_rounded, text: 'Delivery in $eta min from ${store.name}'),
                    if (addr == null)
                      _notice(
                        Icons.location_on_outlined,
                        'Add a delivery address to see the final bill.',
                        BB.amberTint, BB.amber,
                        action: TextButton(
                          onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AddressesScreen())),
                          child: const Text('Add address', style: TextStyle(fontWeight: FontWeight.w800)),
                        ),
                      ),
                    const SizedBox(height: 12),
                    _lines(cart),
                    const SizedBox(height: 12),
                    _deliverySection(store, draft, eta),
                    const SizedBox(height: 12),
                    _couponRow(draft, coupons.length),
                    const SizedBox(height: 12),
                    if (store != null && store.minOrderMinor > cart.itemsTotalMinor)
                      _notice(
                        Icons.info_outline_rounded,
                        'Minimum order for this store is ${money(store.minOrderMinor)}. Add ${money(store.minOrderMinor - cart.itemsTotalMinor)} more.',
                        BB.amberTint, BB.amber,
                      ),
                    if (_quote != null) BillCard(bill: _quote!),
                    if (_quoteError.isNotEmpty) _notice(Icons.error_outline_rounded, _quoteError, BB.redTint, BB.red),
                    if (_quote == null && _quoteError.isEmpty && addr != null)
                      const Padding(padding: EdgeInsets.all(12), child: Text('Calculating bill…', style: TextStyle(fontSize: 12, color: BB.sub))),
                  ],
                ),
      bottomNavigationBar: cart == null || cart.isEmpty ? null : _checkoutCta(cart),
    );
  }

  Widget _lines(Cart cart) {
    final notifier = ref.read(cartProvider.notifier);
    return AppCard(
      padding: EdgeInsets.zero,
      child: Column(children: [
        for (var i = 0; i < cart.items.length; i++) ...[
          if (i > 0) const Divider(height: 1),
          _line(cart.items[i], notifier.priceChangedIds.contains(cart.items[i].productId)),
        ],
      ]),
    );
  }

  Widget _line(CartItem item, bool priceChanged) {
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
        LineArt(productId: item.productId, imageUrl: item.imageUrl),
        const SizedBox(width: 10),
        Expanded(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(item.name, maxLines: 2, overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: BB.ink, height: 1.25)),
            const SizedBox(height: 2),
            Text(item.unit, style: const TextStyle(fontSize: 11, color: BB.sub)),
            const SizedBox(height: 4),
            PriceRow(priceMinor: item.priceMinor, mrpMinor: item.mrpMinor, fontSize: 13),
            if (priceChanged) ...[
              const SizedBox(height: 3),
              const Row(children: [
                Icon(Icons.warning_amber_rounded, size: 12, color: BB.amber),
                SizedBox(width: 3),
                Expanded(child: Text('Price updated since you added it', style: TextStyle(fontSize: 10.5, color: BB.amber, fontWeight: FontWeight.w600))),
              ]),
            ],
            if (!item.available) ...[
              const SizedBox(height: 3),
              const Text('Currently unavailable', style: TextStyle(fontSize: 10.5, color: BB.red, fontWeight: FontWeight.w700)),
            ],
          ]),
        ),
        const SizedBox(width: 8),
        Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          QtyStepper(
            quantity: item.quantity,
            compact: true,
            onChanged: (q) => updateCartQty(context, ref, item.productId, q),
          ),
          const SizedBox(height: 6),
          Text(moneyExact(item.lineTotalMinor), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: BB.ink)),
        ]),
      ]),
    );
  }

  Widget _deliverySection(Store? store, CheckoutDraft draft, int eta) {
    return AppCard(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          const Icon(Icons.local_shipping_outlined, size: 17, color: BB.ink),
          const SizedBox(width: 7),
          const Text('Delivery type', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink)),
          const Spacer(),
          Text(draft.isScheduled ? 'Pick a slot' : 'As fast as possible', style: const TextStyle(fontSize: 11, color: BB.sub)),
        ]),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(child: _deliveryButton(Icons.bolt_rounded, 'Now', '$eta min', !draft.isScheduled, () {
            ref.read(checkoutDraftProvider.notifier).state = draft.copyWith(deliveryType: 'instant');
          })),
          const SizedBox(width: 8),
          Expanded(child: _deliveryButton(Icons.schedule_rounded, 'Later', 'Choose slot', draft.isScheduled, () {
            ref.read(checkoutDraftProvider.notifier).state = draft.copyWith(deliveryType: 'scheduled');
          })),
        ]),
        if (draft.isScheduled && store != null) ...[
          const SizedBox(height: 12),
          SlotPicker(
            storeId: store.id,
            selectedSlotId: draft.slotId,
            onSelected: (s) {
              ref.read(checkoutDraftProvider.notifier).state = draft.copyWith(
                slotId: s.id,
                slotLabel: '${dateLabel(s.date)} · ${slotRange(s.startsAt, s.endsAt)}',
              );
            },
          ),
        ],
      ]),
    );
  }

  Widget _deliveryButton(IconData icon, String title, String sub, bool on, VoidCallback onTap) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: on ? BB.greenTint : BB.card,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: on ? BB.green : BB.line),
          ),
          child: Column(children: [
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              Icon(icon, size: 15, color: on ? BB.greenDark : BB.sub),
              const SizedBox(width: 5),
              Text(title, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: on ? BB.greenDeep : BB.ink)),
            ]),
            const SizedBox(height: 2),
            Text(sub, style: const TextStyle(fontSize: 10.5, color: BB.sub)),
          ]),
        ),
      );

  Widget _couponRow(CheckoutDraft draft, int couponCount) {
    final applied = draft.couponCode.isNotEmpty;
    return InkWell(
      onTap: () => showCouponSheet(context),
      borderRadius: BorderRadius.circular(BB.radius),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(color: BB.card, borderRadius: BorderRadius.circular(BB.radius), border: Border.all(color: BB.line)),
        child: Row(children: [
          const Icon(Icons.percent_rounded, size: 18, color: BB.greenDark),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(applied ? '${draft.couponCode} applied' : 'Apply coupon',
                  style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: BB.ink)),
              Text(applied ? 'Tap to change or remove' : '$couponCount offers available',
                  style: const TextStyle(fontSize: 11, color: BB.sub)),
            ]),
          ),
          if (applied)
            InkWell(
              onTap: () => ref.read(checkoutDraftProvider.notifier).state = draft.copyWith(couponCode: ''),
              child: const Padding(padding: EdgeInsets.all(4), child: Icon(Icons.close_rounded, size: 18, color: BB.red)),
            )
          else
            const Icon(Icons.chevron_right_rounded, color: BB.sub),
        ]),
      ),
    );
  }

  Widget _notice(IconData icon, String text, Color bg, Color fg, {Widget? action}) => Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(10)),
        child: Row(children: [
          Icon(icon, size: 16, color: fg),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: fg))),
          if (action != null) action,
        ]),
      );

  Widget _checkoutCta(Cart cart) {
    final total = _quote?.grandTotalMinor ?? cart.itemsTotalMinor;
    final blocked = _quoteError.isNotEmpty || ref.read(selectedAddressProvider) == null;
    return Container(
      decoration: const BoxDecoration(color: BB.cart, boxShadow: BB.shadowLg),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: SafeArea(
        top: false,
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Text(money(total), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: Colors.white)),
              Text('${cart.count} item${cart.count == 1 ? '' : 's'}${(_quote?.totalSavingsMinor ?? 0) > 0 ? ' · savings applied' : ''}',
                  style: const TextStyle(fontSize: 11, color: Colors.white70)),
            ]),
          ),
          ElevatedButton.icon(
            onPressed: blocked ? null : _checkout,
            style: ElevatedButton.styleFrom(
              backgroundColor: BB.green,
              disabledBackgroundColor: BB.green.withValues(alpha: .4),
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
            ),
            icon: const Text('Checkout', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
            label: const Icon(Icons.arrow_forward_rounded, size: 17),
          ),
        ]),
      ),
    );
  }
}
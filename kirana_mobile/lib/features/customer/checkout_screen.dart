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
import 'customer_data.dart';
import 'customer_providers.dart';
import 'customer_widgets.dart';
import 'track_screen.dart';

const _tips = [0, 1000, 2000, 3000];

/// Checkout: address selection, delivery summary + slot, payment method,
/// rider tip, instructions, live quote and idempotent order placement.
class CheckoutScreen extends ConsumerStatefulWidget {
  const CheckoutScreen({super.key});

  @override
  ConsumerState<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends ConsumerState<CheckoutScreen> {
  final _instructions = TextEditingController();
  String _addressId = '';
  String _paymentMethod = 'cod';
  BillView? _quote;
  String _quoteError = '';
  int _quoteSeq = 0;
  bool _placing = false;

  @override
  void initState() {
    super.initState();
    final selected = ref.read(selectedAddressProvider);
    final addresses = ref.read(addressesProvider).value ?? const <Address>[];
    _addressId = selected?.id ?? (addresses.isNotEmpty ? addresses.first.id : '');
    _bootstrap();
  }

  Future<void> _bootstrap() async {
    try {
      await ref.read(cartProvider.notifier).refresh();
    } catch (_) {
      // Keep the cached basket if the refresh fails.
    }
    _refreshQuote();
  }

  @override
  void dispose() {
    _instructions.dispose();
    super.dispose();
  }

  Future<void> _refreshQuote() async {
    if (_addressId.isEmpty) return;
    final draft = ref.read(checkoutDraftProvider);
    final seq = ++_quoteSeq;
    try {
      final res = await ref.read(apiProvider).quote({
        'address_id': _addressId,
        'coupon_code': draft.couponCode,
        'delivery_type': draft.deliveryType,
        'tip_minor': draft.tipMinor,
      });
      if (!mounted || seq != _quoteSeq) return;
      setState(() {
        _quote = BillView.fromJson(mapFrom(mapFrom(res, 'quote'), 'bill'));
        _quoteError = '';
      });
    } on ApiException catch (e) {
      if (!mounted || seq != _quoteSeq) return;
      setState(() { _quote = null; _quoteError = e.message; });
    }
  }

  Future<void> _pickAddress(Address a) async {
    setState(() => _addressId = a.id);
    try {
      await applyAddress(ref, a);
    } on ApiException catch (e) {
      if (mounted) showSnack(context, e.message, error: true);
    }
    _refreshQuote();
  }

  Future<void> _addAddress() async {
    final addr = await Navigator.of(context).push<Address>(
      MaterialPageRoute(builder: (_) => const AddressFormScreen()),
    );
    if (addr == null || !mounted) return;
    await _pickAddress(addr);
  }

  Future<void> _placeOrder() async {
    if (_placing) return;
    final draft = ref.read(checkoutDraftProvider);
    final cart = ref.read(cartProvider);
    if (_addressId.isEmpty) {
      showSnack(context, 'Select a delivery address', error: true);
      return;
    }
    if (draft.isScheduled && draft.slotId.isEmpty) {
      showSnack(context, 'Choose a delivery slot', error: true);
      return;
    }
    if (_paymentMethod == 'online') {
      final ok = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('Pay online'),
          content: Text('Confirm mock payment of ${money(_quote?.grandTotalMinor ?? 0)}? This is a demo gateway — no real money moves.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
            TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Pay now')),
          ],
        ),
      );
      if (ok != true) return;
    }
    setState(() => _placing = true);
    final api = ref.read(apiProvider);
    try {
      final res = await api.createOrder({
        'address_id': _addressId,
        'store_id': cart?.storeId ?? ref.read(selectedStoreProvider)?.id ?? '',
        'coupon_code': draft.couponCode,
        'tip_minor': draft.tipMinor,
        'payment_method': _paymentMethod,
        'delivery_instructions': _instructions.text.trim(),
        'delivery_type': draft.deliveryType,
        'slot_id': draft.isScheduled ? draft.slotId : null,
      }, newIdempotencyKey());
      final order = Order.fromJson(mapFrom(res, 'order'));
      if (_paymentMethod == 'online') {
        var paymentId = mapFrom(res, 'payment')['payment_id']?.toString() ?? '';
        if (paymentId.isEmpty) {
          final payRes = await api.payOrder(order.id);
          paymentId = mapFrom(payRes, 'payment')['payment_id']?.toString() ?? '';
        }
        if (paymentId.isNotEmpty) await api.confirmPayment(paymentId);
      }
      try {
        await ref.read(cartProvider.notifier).refresh();
      } catch (_) {
        ref.read(cartProvider.notifier).adopt(Cart());
      }
      ref.read(checkoutDraftProvider.notifier).state = const CheckoutDraft();
      ref.read(activeOrderProvider.notifier).state = order;
      ref.invalidate(ordersProvider);
      if (!mounted) return;
      showSnack(context, 'Order placed!');
      Navigator.of(context).pushReplacement(MaterialPageRoute(builder: (_) => TrackScreen(orderId: order.id)));
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _placing = false);
      showSnack(context, e.message, error: true);
      if (e.code == 'PRICE_CHANGED' || e.code == 'INSUFFICIENT_STOCK' || e.code == 'PRODUCT_UNAVAILABLE') {
        try {
          await ref.read(cartProvider.notifier).refresh();
        } catch (_) {}
        _refreshQuote();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cart = ref.watch(cartProvider);
    final addresses = ref.watch(addressesProvider);
    final draft = ref.watch(checkoutDraftProvider);
    final store = ref.watch(selectedStoreProvider);
    final info = ref.watch(serviceInfoProvider);
    final eta = info?.serviceable == true ? info!.etaMinutes : 15;

    return Scaffold(
      appBar: AppBar(title: const Text('Checkout')),
      body: cart == null
          ? const LoadingView()
          : cart.isEmpty
              ? EmptyState(
                  icon: Icons.shopping_basket_outlined,
                  title: 'Your basket is empty',
                  subtitle: 'Add items before checking out.',
                  action: PrimaryButton(label: 'Back to basket', onPressed: () => Navigator.pop(context)),
                )
              : ListView(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                  children: [
                    _section(
                      Icons.location_on_outlined, 'Deliver to',
                      action: TextButton(onPressed: _addAddress, child: const Text('+ Add new', style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w800))),
                      child: addresses.when(
                        loading: () => const LoadingView(),
                        error: (e, _) => ErrorView(message: '$e', onRetry: () => ref.read(addressesProvider.notifier).load()),
                        data: (list) => list.isEmpty
                            ? const Padding(
                                padding: EdgeInsets.all(8),
                                child: Text('No address yet. Add a delivery address to continue.', style: TextStyle(fontSize: 12.5, color: BB.sub)),
                              )
                            : Column(children: [
                                for (final a in list) ...[
                                  AddressCard(address: a, selected: a.id == _addressId, onTap: () => _pickAddress(a)),
                                  const SizedBox(height: 8),
                                ],
                              ]),
                      ),
                    ),
                    _section(
                      Icons.local_shipping_outlined, 'Delivery',
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        InfoRow(label: 'Type', value: draft.isScheduled ? 'Scheduled' : 'Instant (Now)'),
                        if (draft.isScheduled)
                          InfoRow(label: 'Slot', value: draft.slotLabel.isEmpty ? 'Choose a slot below' : draft.slotLabel)
                        else
                          InfoRow(label: 'ETA', value: '$eta min'),
                        if (draft.isScheduled && store != null) ...[
                          const SizedBox(height: 8),
                          SlotPicker(
                            storeId: store.id,
                            selectedSlotId: draft.slotId,
                            onSelected: (s) {
                              ref.read(checkoutDraftProvider.notifier).state = draft.copyWith(
                                slotId: s.id,
                                slotLabel: '${dateLabel(s.date)} · ${slotRange(s.startsAt, s.endsAt)}',
                              );
                              _refreshQuote();
                            },
                          ),
                        ],
                      ]),
                    ),
                    _section(
                      Icons.account_balance_wallet_outlined, 'Payment method',
                      child: Column(children: [
                        _payRow('cod', Icons.payments_outlined, 'Cash on delivery', 'Pay when your order arrives'),
                        const SizedBox(height: 8),
                        _payRow('online', Icons.credit_card_rounded, 'Pay online', 'UPI / card · instant confirmation'),
                      ]),
                    ),
                    _section(
                      Icons.pedal_bike_outlined, 'Tip your rider',
                      child: Wrap(spacing: 8, children: [
                        for (final t in _tips)
                          ChoiceChip(
                            label: Text(t == 0 ? 'No tip' : money(t), style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: draft.tipMinor == t ? Colors.white : BB.ink)),
                            selected: draft.tipMinor == t,
                            selectedColor: BB.green,
                            backgroundColor: BB.card,
                            side: BorderSide(color: draft.tipMinor == t ? BB.green : BB.line),
                            onSelected: (_) {
                              ref.read(checkoutDraftProvider.notifier).state = draft.copyWith(tipMinor: t);
                              _refreshQuote();
                            },
                          ),
                      ]),
                    ),
                    _section(
                      Icons.chat_bubble_outline_rounded, 'Delivery instructions',
                      child: TextField(
                        controller: _instructions,
                        maxLength: 240,
                        maxLines: 2,
                        decoration: const InputDecoration(hintText: 'e.g. Ring the bell, leave at the door', counterText: ''),
                      ),
                    ),
                    if (_quote != null) BillCard(bill: _quote!),
                    if (_quoteError.isNotEmpty)
                      Container(
                        margin: const EdgeInsets.only(top: 10),
                        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                        decoration: BoxDecoration(color: BB.redTint, borderRadius: BorderRadius.circular(10)),
                        child: Row(children: [
                          const Icon(Icons.error_outline_rounded, size: 16, color: BB.red),
                          const SizedBox(width: 8),
                          Expanded(child: Text(_quoteError, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: BB.red))),
                        ]),
                      ),
                  ],
                ),
      bottomNavigationBar: cart == null || cart.isEmpty ? null : _placeCta(cart, draft),
    );
  }

  Widget _section(IconData icon, String title, {required Widget child, Widget? action}) => Padding(
        padding: const EdgeInsets.only(bottom: 14),
        child: AppCard(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Icon(icon, size: 17, color: BB.ink),
              const SizedBox(width: 7),
              Expanded(child: Text(title, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800, color: BB.ink))),
              if (action != null) action,
            ]),
            const SizedBox(height: 10),
            child,
          ]),
        ),
      );

  Widget _payRow(String method, IconData icon, String title, String sub) {
    final on = _paymentMethod == method;
    return InkWell(
      onTap: () => setState(() => _paymentMethod = method),
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
        decoration: BoxDecoration(
          color: on ? BB.greenTint : BB.card,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: on ? BB.green : BB.line),
        ),
        child: Row(children: [
          Icon(icon, size: 19, color: on ? BB.greenDark : BB.sub),
          const SizedBox(width: 10),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800, color: BB.ink)),
              Text(sub, style: const TextStyle(fontSize: 11, color: BB.sub)),
            ]),
          ),
          Icon(on ? Icons.radio_button_checked_rounded : Icons.radio_button_off_rounded, size: 19, color: on ? BB.green : BB.faint),
        ]),
      ),
    );
  }

  Widget _placeCta(Cart cart, CheckoutDraft draft) {
    final total = _quote?.grandTotalMinor ?? 0;
    final blocked = _quote == null || _quoteError.isNotEmpty || _addressId.isEmpty;
    return Container(
      decoration: const BoxDecoration(color: BB.cart, boxShadow: BB.shadowLg),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: SafeArea(
        top: false,
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
              Text(money(total), style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w900, color: Colors.white)),
              Text('${cart.count} item${cart.count == 1 ? '' : 's'} · ${_paymentMethod == 'cod' ? 'Pay on delivery' : 'Pay online'}',
                  style: const TextStyle(fontSize: 11, color: Colors.white70)),
            ]),
          ),
          ElevatedButton.icon(
            onPressed: blocked || _placing ? null : _placeOrder,
            style: ElevatedButton.styleFrom(
              backgroundColor: BB.green,
              disabledBackgroundColor: BB.green.withValues(alpha: .4),
              padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 13),
            ),
            icon: _placing
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2))
                : Text(_placing ? 'Placing…' : 'Place order', style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800)),
            label: const Icon(Icons.check_rounded, size: 17),
          ),
        ]),
      ),
    );
  }
}
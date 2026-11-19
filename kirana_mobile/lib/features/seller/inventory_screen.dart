import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/art.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'product_form_screen.dart';
import 'seller_common.dart';

const lowStockThreshold = 5;

// --- inventory state --------------------------------------------------------

class InventoryState {
  final List<Map<String, dynamic>> products;
  final bool loading;
  final String error;
  final bool lowOnly;
  const InventoryState({this.products = const [], this.loading = true, this.error = '', this.lowOnly = false});

  InventoryState copyWith({List<Map<String, dynamic>>? products, bool? loading, String? error, bool? lowOnly}) =>
      InventoryState(
        products: products ?? this.products,
        loading: loading ?? this.loading,
        error: error ?? this.error,
        lowOnly: lowOnly ?? this.lowOnly,
      );
}

class InventoryController extends StateNotifier<InventoryState> {
  InventoryController(this._api, this.storeId) : super(const InventoryState()) {
    load();
  }

  final ApiClient _api;
  final String storeId;

  Future<void> load({bool silent = false}) async {
    if (!silent) state = state.copyWith(loading: true, error: '');
    try {
      final data = await _api.inventory(storeId, {'low': state.lowOnly ? 'true' : ''});
      if (!mounted) return;
      state = state.copyWith(products: listFrom(data, 'products'), loading: false, error: '');
    } catch (e) {
      if (!mounted) return;
      state = state.copyWith(loading: false, error: silent ? state.error : errorMessage(e));
    }
  }

  void setLowOnly(bool value) {
    state = state.copyWith(lowOnly: value);
    load();
  }

  void replaceProduct(Map<String, dynamic> product) {
    final id = strOf(product['id']);
    state = state.copyWith(
      products: [for (final p in state.products) if (strOf(p['id']) == id) product else p],
    );
    // With the low-stock filter active the row may need to leave the list.
    if (state.lowOnly) load(silent: true);
  }

  /// Quick ± adjust; throws ApiException so the caller can surface the message.
  Future<void> adjust(String pid, int delta, String reason) async {
    final data = await _api.adjustInventory(storeId, pid, {'delta': delta, 'reason': reason});
    if (!mounted) return;
    replaceProduct(mapFrom(data, 'product'));
  }

  Future<void> toggleActive(String pid) async {
    final p = state.products.firstWhere((x) => strOf(x['id']) == pid);
    final data = await _api.updateStoreProduct(storeId, pid, {'active': !boolOf(p['active'])});
    if (!mounted) return;
    replaceProduct(mapFrom(data, 'product'));
  }
}

final inventoryProvider =
    StateNotifierProvider.family<InventoryController, InventoryState, String>((ref, storeId) {
  return InventoryController(ref.watch(apiProvider), storeId);
});

// --- screen -----------------------------------------------------------------

class InventoryScreen extends ConsumerStatefulWidget {
  final String storeId;
  const InventoryScreen({super.key, required this.storeId});
  @override
  ConsumerState<InventoryScreen> createState() => _InventoryScreenState();
}

class _InventoryScreenState extends ConsumerState<InventoryScreen> {
  String _query = '';
  final Set<String> _busy = {};

  List<Map<String, dynamic>> _filtered(List<Map<String, dynamic>> products) {
    final term = _query.toLowerCase();
    if (term.isEmpty) return products;
    return products
        .where((p) => '${strOf(p['name'])} ${strOf(p['brand'])} ${strOf(p['unit'])}'.toLowerCase().contains(term))
        .toList();
  }

  Future<void> _run(String pid, Future<void> Function() action) async {
    if (_busy.contains(pid)) return;
    setState(() => _busy.add(pid));
    try {
      await action();
    } catch (e) {
      if (mounted) showSnack(context, errorMessage(e), error: true);
    } finally {
      if (mounted) setState(() => _busy.remove(pid));
    }
  }

  Future<void> _openAdjustDialog(Map<String, dynamic> p) async {
    final pid = strOf(p['id']);
    final deltaController = TextEditingController();
    final reasonController = TextEditingController(text: 'Stock count');
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: BB.card,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(BB.radiusLg)),
        title: Text('Adjust stock — ${strOf(p['name'])}', style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('On hand ${intOf(p['on_hand'])} · reserved ${intOf(p['reserved'])}. '
              'Use a negative number to remove units.', style: const TextStyle(fontSize: 12.5, color: BB.sub)),
          const SizedBox(height: 14),
          TextField(
            controller: deltaController,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(signed: true),
            decoration: const InputDecoration(labelText: 'Change (+/− units)', isDense: true),
          ),
          const SizedBox(height: 10),
          TextField(
            controller: reasonController,
            decoration: const InputDecoration(labelText: 'Reason', isDense: true),
          ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: const Text('Cancel')),
          ElevatedButton(onPressed: () => Navigator.of(ctx).pop(true), child: const Text('Apply')),
        ],
      ),
    );
    final delta = int.tryParse(deltaController.text.trim());
    final reason = reasonController.text.trim();
    deltaController.dispose();
    reasonController.dispose();
    if (ok != true || !mounted) return;
    if (delta == null || delta == 0 || delta < -9999 || delta > 9999) {
      showSnack(context, 'Enter a non-zero whole number of units', error: true);
      return;
    }
    await _run(pid, () => ref.read(inventoryProvider(widget.storeId).notifier).adjust(pid, delta, reason.isEmpty ? 'Adjustment' : reason));
  }

  Future<void> _openForm(Map<String, dynamic>? product) async {
    final saved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => ProductFormScreen(storeId: widget.storeId, product: product)),
    );
    if (saved == true && mounted) {
      await ref.read(inventoryProvider(widget.storeId).notifier).load(silent: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final inv = ref.watch(inventoryProvider(widget.storeId));
    final list = _filtered(inv.products);
    final lowCount = inv.products.where((p) => boolOf(p['active']) && availableOf(p) <= lowStockThreshold).length;

    return Scaffold(
      backgroundColor: BB.bg,
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: BB.green,
        foregroundColor: Colors.white,
        onPressed: () => _openForm(null),
        icon: const Icon(Icons.add),
        label: const Text('Add item', style: TextStyle(fontWeight: FontWeight.w800)),
      ),
      body: Column(children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
          child: Row(children: [
            Expanded(
              child: TextField(
                onChanged: (v) => setState(() => _query = v.trim()),
                decoration: const InputDecoration(
                  hintText: 'Search name, brand or unit…',
                  prefixIcon: Icon(Icons.search, color: BB.faint, size: 20),
                  isDense: true,
                ),
              ),
            ),
            const SizedBox(width: 8),
            FilterChip(
              label: const Text('Low stock'),
              selected: inv.lowOnly,
              onSelected: (v) => ref.read(inventoryProvider(widget.storeId).notifier).setLowOnly(v),
              labelStyle: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: inv.lowOnly ? Colors.white : BB.sub),
              selectedColor: BB.amber,
              backgroundColor: BB.card,
              side: BorderSide(color: inv.lowOnly ? BB.amber : BB.line),
              showCheckmark: false,
            ),
          ]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Text('${list.length} of ${inv.products.length} items · $lowCount low on stock',
                style: const TextStyle(fontSize: 11, color: BB.sub)),
          ),
        ),
        Expanded(child: _body(inv, list)),
      ]),
    );
  }

  Widget _body(InventoryState inv, List<Map<String, dynamic>> list) {
    if (inv.loading && inv.products.isEmpty) return const LoadingView();
    if (inv.error.isNotEmpty && inv.products.isEmpty) {
      return ErrorView(message: inv.error, onRetry: () => ref.read(inventoryProvider(widget.storeId).notifier).load());
    }
    if (list.isEmpty) {
      return ListView(physics: const AlwaysScrollableScrollPhysics(), children: [
        Padding(
          padding: const EdgeInsets.only(top: 48),
          child: EmptyState(
            icon: _query.isNotEmpty ? Icons.search_off : Icons.inventory_2_outlined,
            title: _query.isNotEmpty ? 'No matches' : inv.lowOnly ? 'Nothing running low' : 'No items yet',
            subtitle: _query.isNotEmpty
                ? 'No items match “$_query”.'
                : inv.lowOnly
                    ? 'Every active item has healthy stock right now.'
                    : 'Add your first item with the button below.',
          ),
        ),
      ]);
    }
    return RefreshIndicator(
      color: BB.green,
      onRefresh: () => ref.read(inventoryProvider(widget.storeId).notifier).load(silent: true),
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
        itemCount: list.length,
        itemBuilder: (_, i) => _row(list[i]),
      ),
    );
  }

  Widget _row(Map<String, dynamic> p) {
    final pid = strOf(p['id']);
    final available = availableOf(p);
    final onHand = intOf(p['on_hand']);
    final reserved = intOf(p['reserved']);
    final out = available <= 0;
    final low = !out && available <= lowStockThreshold;
    final active = boolOf(p['active']);
    final busy = _busy.contains(pid);
    final discount = intOf(p['discount_percent']);
    final aisle = strOf(p['aisle']);
    final shelf = strOf(p['shelf']);

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Opacity(
        opacity: active ? 1 : .55,
        child: AppCard(
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            ArtImage(
              url: productArtUrl(p),
              categoryId: strOf(p['category_id']),
              width: 48,
              height: 48,
              fit: BoxFit.contain,
              borderRadius: BorderRadius.circular(8),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(strOf(p['name']), maxLines: 2, overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w700, color: BB.ink, height: 1.2)),
                const SizedBox(height: 2),
                Text('${strOf(p['brand']).isNotEmpty ? '${strOf(p['brand'])} · ' : ''}${strOf(p['unit'])}',
                    style: const TextStyle(fontSize: 11.5, color: BB.sub)),
                const SizedBox(height: 4),
                Row(children: [
                  PriceRow(priceMinor: intOf(p['price_minor']), mrpMinor: intOf(p['mrp_minor']), fontSize: 13),
                  if (discount > 0) ...[
                    const SizedBox(width: 6),
                    Text('$discount% off', style: const TextStyle(fontSize: 11, color: BB.greenDark, fontWeight: FontWeight.w700)),
                  ],
                ]),
                const SizedBox(height: 4),
                Text('Aisle ${aisle.isNotEmpty ? aisle : '—'} · Shelf ${shelf.isNotEmpty ? shelf : '—'} · on hand $onHand · reserved $reserved',
                    style: const TextStyle(fontSize: 10.5, color: BB.faint)),
                const SizedBox(height: 6),
                out
                    ? const Pill(label: 'Out of stock', color: BB.red, tint: BB.redTint)
                    : low
                        ? Pill(label: 'Low · $available left', color: BB.amber, tint: BB.amberTint)
                        : Pill(label: '$available available', color: BB.saveInk, tint: BB.saveTint),
              ]),
            ),
            const SizedBox(width: 8),
            Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
              CountStepper(
                value: onHand,
                min: reserved,
                max: 99999,
                busy: busy,
                onChanged: (v) => _run(pid, () => ref
                    .read(inventoryProvider(widget.storeId).notifier)
                    .adjust(pid, v - onHand, 'Quick adjust')),
              ),
              const SizedBox(height: 6),
              Row(mainAxisSize: MainAxisSize.min, children: [
                _miniIcon(Icons.edit_outlined, BB.sub, () => _openForm(p), 'Edit'),
                _miniIcon(Icons.tune, BB.sub, () => _openAdjustDialog(p), 'Adjust stock'),
                _miniIcon(
                  active ? Icons.visibility : Icons.visibility_off,
                  active ? BB.greenDark : BB.faint,
                  () => _run(pid, () async {
                    await ref.read(inventoryProvider(widget.storeId).notifier).toggleActive(pid);
                    if (mounted) showSnack(context, '${strOf(p['name'])} ${active ? 'hidden from' : 'visible to'} customers');
                  }),
                  active ? 'Hide' : 'Show',
                ),
              ]),
            ]),
          ]),
        ),
      ),
    );
  }

  Widget _miniIcon(IconData icon, Color color, VoidCallback onTap, String tooltip) => IconButton(
        onPressed: onTap,
        icon: Icon(icon, size: 18, color: color),
        tooltip: tooltip,
        visualDensity: VisualDensity.compact,
        padding: const EdgeInsets.all(6),
        constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
      );
}
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/api_client.dart';
import '../../core/api/api_exception.dart';
import '../../core/art.dart';
import '../../core/models.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/widgets.dart';
import 'customer_data.dart';
import 'customer_providers.dart';
import 'customer_widgets.dart';
import 'product_screen.dart';

const _sorts = [
  ('', 'Popular'),
  ('price_asc', 'Price: low to high'),
  ('price_desc', 'Price: high to low'),
  ('discount', 'Biggest discount'),
  ('name', 'Name A–Z'),
];
const _pageSize = 24;

/// Browse / search: category chips, sort + in-stock filters, live search and
/// a paginated product grid with ADD steppers wired to the real cart.
class BrowseScreen extends ConsumerStatefulWidget {
  const BrowseScreen({super.key});

  @override
  ConsumerState<BrowseScreen> createState() => _BrowseScreenState();
}

class _BrowseScreenState extends ConsumerState<BrowseScreen> {
  final _searchController = TextEditingController();
  final _focusNode = FocusNode();
  Timer? _debounce;

  String _q = '';
  String _sort = '';
  bool _inStock = false;
  int _page = 1;
  int _total = 0;
  List<Product> _products = [];
  bool _loading = true;
  bool _loadingMore = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _load(reset: true);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  Future<void> _load({bool reset = false}) async {
    final store = ref.read(selectedStoreProvider);
    if (store == null) {
      setState(() { _loading = false; _error = 'Select a store to browse products.'; });
      return;
    }
    final category = ref.read(browseCategoryProvider);
    if (reset) {
      _page = 1;
      setState(() { _loading = true; _error = ''; });
    } else {
      setState(() => _loadingMore = true);
    }
    try {
      final api = ref.read(apiProvider);
      List<Product> batch;
      int total;
      if (_q.isNotEmpty) {
        final res = await api.search(store.id, _q);
        batch = listFrom(res, 'products').map(parseProduct).toList();
        total = batch.length;
      } else {
        final res = await api.products(store.id, {
          'category': category,
          'sort': _sort,
          'in_stock': _inStock ? 'true' : '',
          'page': _page,
          'page_size': _pageSize,
        });
        batch = listFrom(res, 'products').map(parseProduct).toList();
        total = mapFrom(res)['total'] is num ? (mapFrom(res)['total'] as num).toInt() : batch.length;
      }
      if (!mounted) return;
      setState(() {
        _products = reset ? batch : [..._products, ...batch];
        _total = total;
        _loading = false;
        _loadingMore = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() { _loading = false; _loadingMore = false; _error = e.message; });
    }
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      if (!mounted) return;
      _q = value.trim();
      _load(reset: true);
    });
  }

  Future<void> _openSort() async {
    final selected = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: BB.card,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(BB.radiusLg))),
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const Padding(padding: EdgeInsets.all(16), child: Text('Sort by', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800))),
          for (final (key, label) in _sorts)
            ListTile(
              dense: true,
              title: Text(label, style: const TextStyle(fontSize: 14)),
              trailing: key == _sort ? const Icon(Icons.check_rounded, color: BB.green, size: 20) : null,
              onTap: () => Navigator.pop(ctx, key),
            ),
          const SizedBox(height: 8),
        ]),
      ),
    );
    if (selected != null && selected != _sort) {
      setState(() => _sort = selected);
      _load(reset: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(browseCategoryProvider, (_, __) => _load(reset: true));
    ref.listen(selectedStoreProvider, (_, __) => _load(reset: true));
    ref.listen(browseSearchFocusProvider, (_, __) => _focusNode.requestFocus());

    final category = ref.watch(browseCategoryProvider);
    final categories = ref.watch(categoriesProvider).value ?? const <Category>[];
    final cart = ref.watch(cartProvider);
    final sortLabel = _sorts.firstWhere((s) => s.$1 == _sort, orElse: () => _sorts.first).$2;
    final hasMore = _q.isEmpty && _products.length < _total;

    return Scaffold(
      body: Column(children: [
        const CustomerHeader(),
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
          child: TextField(
            controller: _searchController,
            focusNode: _focusNode,
            onChanged: _onSearchChanged,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              hintText: 'Search milk, atta, snacks…',
              prefixIcon: const Icon(Icons.search_rounded, color: BB.sub, size: 20),
              suffixIcon: _q.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.close_rounded, size: 18, color: BB.sub),
                      onPressed: () {
                        _searchController.clear();
                        _q = '';
                        _load(reset: true);
                      },
                    ),
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            ),
          ),
        ),
        if (_q.isEmpty) ...[
          const SizedBox(height: 10),
          SizedBox(
            height: 40,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                _catChip('', 'All', null, category.isEmpty),
                for (final c in categories) _catChip(c.id, c.name, categoryArtUrl(c.id), category == c.id),
              ],
            ),
          ),
        ],
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 4),
          child: Row(children: [
            _filterChip(Icons.sort_rounded, sortLabel, false, _openSort),
            const SizedBox(width: 8),
            _filterChip(Icons.check_rounded, 'In stock', _inStock, () {
              setState(() => _inStock = !_inStock);
              _load(reset: true);
            }),
          ]),
        ),
        Expanded(child: _results(cart, hasMore)),
      ]),
    );
  }

  Widget _results(Cart? cart, bool hasMore) {
    if (_loading && _products.isEmpty) return const LoadingView();
    if (_error.isNotEmpty && _products.isEmpty) {
      return ErrorView(message: _error, onRetry: () => _load(reset: true));
    }
    if (_products.isEmpty) {
      return EmptyState(
        icon: _q.isNotEmpty ? Icons.search_off_rounded : Icons.shopping_basket_outlined,
        title: _q.isNotEmpty ? 'No results for "$_q"' : 'Nothing here yet',
        subtitle: _q.isNotEmpty
            ? 'Try a different spelling or browse a category.'
            : 'Try another category or turn off the in-stock filter.',
      );
    }
    return Column(children: [
      Expanded(
        child: GridView.builder(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2, mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 0.60),
          itemCount: _products.length,
          itemBuilder: (context, i) {
            final p = _products[i];
            return ProductCard(
              product: p,
              quantity: cartQtyOf(cart, p.id),
              onQuantity: (q) => updateCartQty(context, ref, p.id, q),
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ProductScreen(productId: p.id, initial: p))),
            );
          },
        ),
      ),
      if (hasMore)
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
          child: SizedBox(
            width: double.infinity,
            child: OutlinedButton(
              onPressed: _loadingMore ? null : () { _page += 1; _load(); },
              child: _loadingMore
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2.2))
                  : Text('Load more (${_total - _products.length} left)'),
            ),
          ),
        )
      else
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Text('${_products.length} of $_total products', style: const TextStyle(fontSize: 11, color: BB.faint)),
        ),
    ]);
  }

  Widget _catChip(String id, String name, String? artUrl, bool selected) => Padding(
        padding: const EdgeInsets.only(right: 8),
        child: InkWell(
          onTap: () => ref.read(browseCategoryProvider.notifier).state = id,
          borderRadius: BorderRadius.circular(20),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: selected ? BB.greenTint : BB.card,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(color: selected ? BB.green : BB.line),
            ),
            child: Row(mainAxisSize: MainAxisSize.min, children: [
              if (artUrl == null)
                const Icon(Icons.grid_view_rounded, size: 16, color: BB.greenDark)
              else
                ArtImage(url: artUrl, categoryId: id, width: 20, height: 20, fit: BoxFit.contain, borderRadius: BorderRadius.circular(4)),
              const SizedBox(width: 6),
              Text(name, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: selected ? BB.greenDeep : BB.ink)),
            ]),
          ),
        ),
      );

  Widget _filterChip(IconData icon, String label, bool on, VoidCallback onTap) => InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
          decoration: BoxDecoration(
            color: on ? BB.greenTint : BB.card,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: on ? BB.green : BB.line),
          ),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, size: 14, color: on ? BB.greenDark : BB.sub),
            const SizedBox(width: 5),
            Text(label, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: on ? BB.greenDeep : BB.ink)),
          ]),
        ),
      );
}
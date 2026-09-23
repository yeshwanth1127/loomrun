import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_typography.dart';
import 'lead_details_screen.dart';
import 'leads_controller.dart';
import 'models/lead.dart';
import 'new_lead_screen.dart';

const _mono = 'monospace';
const _hairline = Color(0x4DE5E9EE);

class LeadsScreen extends StatefulWidget {
  const LeadsScreen({super.key});

  @override
  State<LeadsScreen> createState() => _LeadsScreenState();
}

class _LeadsScreenState extends State<LeadsScreen> {
  final _searchController = TextEditingController();
  bool _tableView = false;

  @override
  void initState() {
    super.initState();
    leadsController.addListener(_onChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (!leadsController.loadedOnce) {
        leadsController.refresh();
      }
    });
  }

  @override
  void dispose() {
    leadsController.removeListener(_onChanged);
    _searchController.dispose();
    super.dispose();
  }

  void _onChanged() {
    if (mounted) setState(() {});
  }

  Future<void> _addLead() async {
    await Navigator.of(context).push<Lead>(
      MaterialPageRoute(builder: (_) => const NewLeadScreen()),
    );
  }

  void _openFilters() {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => _FilterSheet(
        initial: leadsController.filters,
        onApply: leadsController.setFilters,
      ),
    );
  }

  void _importCsv() {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(
        const SnackBar(
          backgroundColor: AppColors.inverseSurface,
          behavior: SnackBarBehavior.floating,
          content: Text(
            'CSV import opens the file picker on device.',
            style: TextStyle(color: AppColors.inverseOnSurface, fontSize: 13),
          ),
        ),
      );
  }

  @override
  Widget build(BuildContext context) {
    final filters = leadsController.filters;
    final stages = leadsController.visibleStages;

    return Scaffold(
      backgroundColor: AppColors.surface,
      floatingActionButton: FloatingActionButton(
        onPressed: _addLead,
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        elevation: 2,
        child: const Icon(Icons.add),
      ),
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 8, 0),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Leads',
                          style: AppTypography.heading(fontSize: 26),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          '${leadsController.totalCount} '
                          '${leadsController.totalCount == 1 ? "lead" : "leads"}',
                          style: const TextStyle(
                            fontSize: 13,
                            color: AppColors.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    tooltip: 'Import CSV',
                    onPressed: _importCsv,
                    icon: const Icon(Icons.upload_file_outlined,
                        size: 20, color: AppColors.onSurfaceVariant),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),

            // Toolbar: Board/Table + filters. Search sits below, always
            // visible — the web keeps its search field docked in the toolbar.
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Row(
                children: [
                  _ViewToggle(
                    tableView: _tableView,
                    onChanged: (v) => setState(() => _tableView = v),
                  ),
                  const Spacer(),
                  _ToolbarIcon(
                    icon: Icons.tune,
                    active: filters.hasAdvanced,
                    onTap: _openFilters,
                  ),
                ],
              ),
            ),

            const SizedBox(height: 10),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: TextField(
                controller: _searchController,
                style: const TextStyle(fontSize: 14),
                onChanged: (v) =>
                    leadsController.setFilters(filters.copyWith(query: v)),
                decoration: InputDecoration(
                  hintText: 'Search name, phone…',
                  isDense: true,
                  prefixIcon: const Icon(Icons.search, size: 18),
                  filled: true,
                  fillColor: AppColors.surfaceContainerLowest,
                  contentPadding: const EdgeInsets.symmetric(
                      vertical: 10, horizontal: 12),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide:
                        const BorderSide(color: AppColors.outlineVariant),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(8),
                    borderSide:
                        const BorderSide(color: AppColors.outlineVariant),
                  ),
                ),
              ),
            ),

            if (filters.hasAdvanced)
              _ActiveFilterRow(
                filters: filters,
                onClear: () => leadsController.setFilters(
                  LeadFilters(
                    query: filters.query,
                    showClosed: filters.showClosed,
                  ),
                ),
              ),

            // "Show closed" applies to both Board and Table, like the web.
            _ShowClosedToggle(
              value: filters.showClosed,
              closedCount: leadsController.closedCount,
              onChanged: (v) =>
                  leadsController.setFilters(filters.copyWith(showClosed: v)),
            ),
            const SizedBox(height: 10),

            Expanded(
              child: _tableView
                  ? _LeadTable(leads: leadsController.filtered())
                  : _BoardView(key: ValueKey(stages.length), stages: stages),
            ),
          ],
        ),
      ),
    );
  }
}

// ── Board ──────────────────────────────────────────────────────────────────

class _BoardView extends StatelessWidget {
  final List<LeadStage> stages;

  const _BoardView({super.key, required this.stages});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: stages.length,
      child: Column(
        children: [
          _StageTabBar(stages: stages),
          Expanded(
            child: TabBarView(
              children: [
                for (final stage in stages) _BoardColumn(stage: stage),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StageTabBar extends StatelessWidget {
  final List<LeadStage> stages;

  const _StageTabBar({required this.stages});

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(top: 12),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: _hairline)),
      ),
      child: TabBar(
        isScrollable: true,
        tabAlignment: TabAlignment.start,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        labelPadding: const EdgeInsets.symmetric(horizontal: 10),
        indicatorColor: AppColors.primary,
        indicatorWeight: 2,
        indicatorSize: TabBarIndicatorSize.tab,
        dividerColor: Colors.transparent,
        labelColor: AppColors.primary,
        unselectedLabelColor: AppColors.outline,
        labelStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
        unselectedLabelStyle:
            const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
        tabs: [
          for (final stage in stages)
            Tab(
              height: 40,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(stage.label),
                  const SizedBox(width: 6),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceContainer,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      '${leadsController.countForStage(stage)}',
                      style: const TextStyle(
                        fontFamily: _mono,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: AppColors.onSurfaceVariant,
                      ),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _ShowClosedToggle extends StatelessWidget {
  final bool value;
  final int closedCount;
  final ValueChanged<bool> onChanged;

  const _ShowClosedToggle({
    required this.value,
    required this.closedCount,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: GestureDetector(
        onTap: () => onChanged(!value),
        behavior: HitTestBehavior.opaque,
        child: Row(
          children: [
            SizedBox(
              width: 18,
              height: 18,
              child: Checkbox(
                value: value,
                onChanged: (v) => onChanged(v ?? false),
                visualDensity: VisualDensity.compact,
                materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                activeColor: AppColors.primary,
                side: const BorderSide(color: AppColors.outline),
              ),
            ),
            const SizedBox(width: 8),
            Text(
              'Show closed ($closedCount)',
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BoardColumn extends StatelessWidget {
  final LeadStage stage;

  const _BoardColumn({required this.stage});

  @override
  Widget build(BuildContext context) {
    final leads = leadsController.filtered(stage: stage);
    final total = leadsController.valueForStage(stage);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: AppColors.surfaceContainer,
            borderRadius: BorderRadius.circular(10),
          ),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  stage.label,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.onSurface,
                  ),
                ),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 1),
                decoration: BoxDecoration(
                  color: AppColors.surfaceContainerLowest,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  '${leads.length}',
                  style: const TextStyle(
                    fontFamily: _mono,
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: AppColors.onSurfaceVariant,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Text(
                formatInr(total),
                style: const TextStyle(
                  fontFamily: _mono,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: AppColors.primary,
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: leads.isEmpty
              ? const _EmptyColumn()
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
                  itemCount: leads.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (_, i) => _LeadCard(lead: leads[i]),
                ),
        ),
      ],
    );
  }
}

class _EmptyColumn extends StatelessWidget {
  const _EmptyColumn();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        margin: const EdgeInsets.all(16),
        padding: const EdgeInsets.symmetric(vertical: 28, horizontal: 24),
        width: double.infinity,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.outlineVariant),
        ),
        child: const Text(
          'No leads in this stage',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 13, color: AppColors.onSurfaceVariant),
        ),
      ),
    );
  }
}

class _LeadCard extends StatelessWidget {
  final Lead lead;

  const _LeadCard({required this.lead});

  @override
  Widget build(BuildContext context) {
    final accent = scoreColor(lead.score);
    return Material(
      color: AppColors.surfaceContainerLowest,
      borderRadius: BorderRadius.circular(10),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(builder: (_) => LeadDetailsScreen(lead: lead)),
        ),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.outlineVariant),
          ),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(width: 3, color: accent),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          lead.name,
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: AppColors.onSurface,
                          ),
                        ),
                        if (lead.company.isNotEmpty) ...[
                          const SizedBox(height: 1),
                          Text(
                            lead.company,
                            style: const TextStyle(
                              fontSize: 13,
                              color: AppColors.onSurfaceVariant,
                            ),
                          ),
                        ],
                        const SizedBox(height: 9),
                        Wrap(
                          spacing: 6,
                          runSpacing: 6,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            _Chip(label: lead.source.label),
                            _Chip(
                              label: '${lead.score}',
                              color: accent,
                              filled: true,
                            ),
                            if (lead.status.isNotEmpty)
                              _Chip(label: lead.status),
                          ],
                        ),
                        const SizedBox(height: 9),
                        Text(
                          [
                            if (lead.location.isNotEmpty) lead.location,
                            formatRelative(lead.lastActivity),
                            formatInr(lead.value),
                          ].join(' · '),
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.outline,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  final String label;
  final Color? color;
  final bool filled;

  const _Chip({required this.label, this.color, this.filled = false});

  @override
  Widget build(BuildContext context) {
    final c = color ?? AppColors.outline;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
      decoration: BoxDecoration(
        color: filled ? c.withValues(alpha: 0.16) : AppColors.surfaceContainer,
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontFamily: _mono,
          fontSize: 10.5,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.3,
          color: filled ? c : AppColors.onSurfaceVariant,
        ),
      ),
    );
  }
}

// ── Table view ─────────────────────────────────────────────────────────────

class _LeadTable extends StatelessWidget {
  final List<Lead> leads;

  const _LeadTable({required this.leads});

  @override
  Widget build(BuildContext context) {
    if (leads.isEmpty) {
      return const Center(
        child: Text('No leads match your filters.',
            style: TextStyle(color: AppColors.onSurfaceVariant)),
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 96),
      itemCount: leads.length + 1,
      separatorBuilder: (_, _) => const Divider(height: 1, color: _hairline),
      itemBuilder: (context, i) {
        if (i == 0) {
          return const Padding(
            padding: EdgeInsets.only(bottom: 8),
            child: Row(
              children: [
                Expanded(flex: 5, child: _Th('LEAD')),
                Expanded(flex: 3, child: _Th('STAGE')),
                SizedBox(width: 34, child: _Th('SC', end: true)),
                Expanded(flex: 3, child: _Th('VALUE', end: true)),
              ],
            ),
          );
        }
        final lead = leads[i - 1];
        return InkWell(
          onTap: () => Navigator.of(context).push(
            MaterialPageRoute(builder: (_) => LeadDetailsScreen(lead: lead)),
          ),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 10),
            child: Row(
              children: [
                Expanded(
                  flex: 5,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        lead.name,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppColors.onSurface,
                        ),
                      ),
                      if (lead.company.isNotEmpty)
                        Text(
                          lead.company,
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.onSurfaceVariant,
                          ),
                        ),
                    ],
                  ),
                ),
                Expanded(
                  flex: 3,
                  child: Text(
                    lead.stage.label,
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.onSurfaceVariant,
                    ),
                  ),
                ),
                SizedBox(
                  width: 34,
                  child: Text(
                    '${lead.score}',
                    textAlign: TextAlign.right,
                    style: TextStyle(
                      fontFamily: _mono,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: scoreColor(lead.score),
                    ),
                  ),
                ),
                Expanded(
                  flex: 3,
                  child: Text(
                    formatInr(lead.value),
                    textAlign: TextAlign.right,
                    style: const TextStyle(
                      fontFamily: _mono,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.onSurface,
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _Th extends StatelessWidget {
  final String text;
  final bool end;
  const _Th(this.text, {this.end = false});

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      textAlign: end ? TextAlign.right : TextAlign.left,
      style: const TextStyle(
        fontFamily: _mono,
        fontSize: 10,
        fontWeight: FontWeight.bold,
        letterSpacing: 1,
        color: AppColors.outline,
      ),
    );
  }
}

// ── Toolbar widgets ────────────────────────────────────────────────────────

class _ViewToggle extends StatelessWidget {
  final bool tableView;
  final ValueChanged<bool> onChanged;

  const _ViewToggle({required this.tableView, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: AppColors.surfaceContainer,
        borderRadius: BorderRadius.circular(9),
      ),
      child: Row(
        children: [
          _segment('Board', Icons.view_kanban_outlined, !tableView,
              () => onChanged(false)),
          _segment('Table', Icons.table_rows_outlined, tableView,
              () => onChanged(true)),
        ],
      ),
    );
  }

  Widget _segment(String label, IconData icon, bool selected, VoidCallback tap) {
    return GestureDetector(
      onTap: tap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color:
              selected ? AppColors.surfaceContainerLowest : Colors.transparent,
          borderRadius: BorderRadius.circular(7),
        ),
        child: Row(
          children: [
            Icon(icon,
                size: 15,
                color: selected ? AppColors.primary : AppColors.outline),
            const SizedBox(width: 5),
            Text(
              label,
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: selected ? AppColors.primary : AppColors.outline,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ToolbarIcon extends StatelessWidget {
  final IconData icon;
  final bool active;
  final VoidCallback onTap;

  const _ToolbarIcon({
    required this.icon,
    required this.active,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 38,
        height: 38,
        decoration: BoxDecoration(
          color: active ? AppColors.primary : AppColors.surfaceContainerLowest,
          borderRadius: BorderRadius.circular(9),
          border: Border.all(
            color: active ? AppColors.primary : AppColors.outlineVariant,
          ),
        ),
        child: Icon(icon,
            size: 18,
            color: active ? Colors.white : AppColors.onSurfaceVariant),
      ),
    );
  }
}

class _ActiveFilterRow extends StatelessWidget {
  final LeadFilters filters;
  final VoidCallback onClear;

  const _ActiveFilterRow({required this.filters, required this.onClear});

  @override
  Widget build(BuildContext context) {
    final chips = <String>[
      if (filters.source != null) filters.source!.label,
      if (filters.stage != null) filters.stage!.label,
      if (filters.scoreMin != null) '≥ ${filters.scoreMin}',
      if (filters.scoreMax != null) '≤ ${filters.scoreMax}',
    ];
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 0),
      child: Row(
        children: [
          Expanded(
            child: Wrap(
              spacing: 6,
              runSpacing: 6,
              children: [
                for (final c in chips)
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: AppColors.surfaceContainer,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      c,
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: AppColors.onSurfaceVariant,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          GestureDetector(
            onTap: onClear,
            child: const Text(
              'Clear',
              style: TextStyle(
                fontFamily: _mono,
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: AppColors.primary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ── Filter sheet ───────────────────────────────────────────────────────────

class _FilterSheet extends StatefulWidget {
  final LeadFilters initial;
  final ValueChanged<LeadFilters> onApply;

  const _FilterSheet({required this.initial, required this.onApply});

  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  late LeadSource? _source = widget.initial.source;
  late LeadStage? _stage = widget.initial.stage;
  late final _minController =
      TextEditingController(text: widget.initial.scoreMin?.toString() ?? '');
  late final _maxController =
      TextEditingController(text: widget.initial.scoreMax?.toString() ?? '');
  late bool _showClosed = widget.initial.showClosed;

  @override
  void dispose() {
    _minController.dispose();
    _maxController.dispose();
    super.dispose();
  }

  void _apply() {
    widget.onApply(LeadFilters(
      query: widget.initial.query,
      source: _source,
      stage: _stage,
      scoreMin: int.tryParse(_minController.text.trim()),
      scoreMax: int.tryParse(_maxController.text.trim()),
      showClosed: _showClosed,
    ));
    Navigator.of(context).pop();
  }

  void _reset() {
    setState(() {
      _source = null;
      _stage = null;
      _minController.clear();
      _maxController.clear();
      _showClosed = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(
        left: 20,
        right: 20,
        top: 4,
        bottom: 20 + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Text(
                  'Filters',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: AppColors.primary,
                  ),
                ),
                const Spacer(),
                TextButton(onPressed: _reset, child: const Text('Reset')),
              ],
            ),
            const SizedBox(height: 8),
            const _SheetLabel('SOURCE'),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _choice('All', _source == null,
                    () => setState(() => _source = null)),
                for (final s in LeadSource.values)
                  _choice(s.label, _source == s,
                      () => setState(() => _source = s)),
              ],
            ),
            const SizedBox(height: 20),
            const _SheetLabel('STAGE'),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _choice('All', _stage == null,
                    () => setState(() => _stage = null)),
                for (final s in LeadStage.values)
                  _choice(s.label, _stage == s,
                      () => setState(() => _stage = s)),
              ],
            ),
            const SizedBox(height: 20),
            const _SheetLabel('SCORE'),
            const SizedBox(height: 8),
            Row(
              children: [
                Expanded(child: _scoreField(_minController, 'Min')),
                const SizedBox(width: 12),
                Expanded(child: _scoreField(_maxController, 'Max')),
              ],
            ),
            const SizedBox(height: 12),
            GestureDetector(
              onTap: () => setState(() => _showClosed = !_showClosed),
              behavior: HitTestBehavior.opaque,
              child: Row(
                children: [
                  SizedBox(
                    width: 18,
                    height: 18,
                    child: Checkbox(
                      value: _showClosed,
                      onChanged: (v) =>
                          setState(() => _showClosed = v ?? false),
                      visualDensity: VisualDensity.compact,
                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      activeColor: AppColors.primary,
                    ),
                  ),
                  const SizedBox(width: 8),
                  const Text('Show closed leads (Won / Lost)',
                      style: TextStyle(fontSize: 13)),
                ],
              ),
            ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              height: 50,
              child: FilledButton(
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                onPressed: _apply,
                child: const Text(
                  'APPLY FILTERS',
                  style: TextStyle(
                    fontFamily: _mono,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 1,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _scoreField(TextEditingController c, String hint) {
    return TextField(
      controller: c,
      keyboardType: TextInputType.number,
      style: const TextStyle(fontSize: 14),
      decoration: InputDecoration(
        hintText: hint,
        isDense: true,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: AppColors.outlineVariant),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: AppColors.primary, width: 2),
        ),
      ),
    );
  }

  Widget _choice(String label, bool selected, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color:
              selected ? AppColors.primary : AppColors.surfaceContainerLowest,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: selected ? AppColors.primary : AppColors.outlineVariant,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: selected ? Colors.white : AppColors.onSurfaceVariant,
          ),
        ),
      ),
    );
  }
}

class _SheetLabel extends StatelessWidget {
  final String text;
  const _SheetLabel(this.text);

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: const TextStyle(
          fontFamily: _mono,
          fontSize: 11,
          fontWeight: FontWeight.bold,
          letterSpacing: 1,
          color: AppColors.outline,
        ),
      );
}

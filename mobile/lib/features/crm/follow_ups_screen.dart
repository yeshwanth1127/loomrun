import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_typography.dart';
import 'follow_ups_controller.dart';
import 'lead_details_screen.dart';
import 'leads_controller.dart';
import 'models/follow_up.dart';
import 'models/lead.dart';
import 'new_follow_up_screen.dart';

const _mono = 'monospace';
const _hairline = Color(0x4DE5E9EE);

class FollowUpsScreen extends StatefulWidget {
  const FollowUpsScreen({super.key});

  @override
  State<FollowUpsScreen> createState() => _FollowUpsScreenState();
}

class _FollowUpsScreenState extends State<FollowUpsScreen> {
  FollowUpTab _tab = FollowUpTab.all;
  final _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (!followUpsController.loadedOnce) {
        followUpsController.refresh();
      }
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _openLead(FollowUp followUp) {
    final match = leadsController.all.where((l) => l.id == followUp.leadId);
    final lead = match.isNotEmpty
        ? match.first
        : Lead(
            id: followUp.leadId,
            name: followUp.customerName,
            company: followUp.company,
            phone: followUp.phone,
            location: '',
            source: LeadSource.whatsapp,
            score: 0,
            status: '',
            stage: LeadStage.newLead,
            value: 0,
            lastActivity: followUp.dateTime,
          );
    Navigator.of(context).push(
      MaterialPageRoute(builder: (_) => LeadDetailsScreen(lead: lead)),
    );
  }

  Future<void> _schedule() async {
    await Navigator.of(context).push<FollowUp>(
      MaterialPageRoute(builder: (_) => const NewFollowUpScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _schedule,
        backgroundColor: AppColors.primary,
        foregroundColor: Colors.white,
        elevation: 2,
        icon: const Icon(Icons.add),
        label: const Text(
          'Schedule follow-up',
          style: TextStyle(fontWeight: FontWeight.w600),
        ),
      ),
      body: SafeArea(
        bottom: false,
        child: ListenableBuilder(
          listenable: followUpsController,
          builder: (context, _) {
            final now = DateTime.now();
            return CustomScrollView(
              slivers: [
                SliverToBoxAdapter(child: _header(now)),
                SliverToBoxAdapter(child: _metrics(now)),
                SliverToBoxAdapter(child: _tabs(now)),
                SliverToBoxAdapter(child: _search()),
                ..._listSlivers(now),
                const SliverToBoxAdapter(child: SizedBox(height: 96)),
              ],
            );
          },
        ),
      ),
    );
  }

  Widget _header(DateTime now) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 10,
            runSpacing: 4,
            children: [
              Text(
                'Follow ups',
                style: AppTypography.heading(fontSize: 26),
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: AppColors.secondaryContainer,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  '${followUpsController.scheduledCount} scheduled',
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: AppColors.primary,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          const Text(
            'Stay on top of every follow-up and never miss one.',
            style: TextStyle(fontSize: 14, color: AppColors.onSurfaceVariant),
          ),
        ],
      ),
    );
  }

  Widget _metrics(DateTime now) {
    final tiles = [
      _Metric(
        label: 'TOTAL FOLLOW UPS',
        value: '${followUpsController.scheduledCount}',
        caption: 'Scheduled',
        tint: AppColors.secondaryContainer,
      ),
      _Metric(
        label: 'DUE TODAY',
        value: '${followUpsController.dueToday(now).length}',
        caption: 'High priority',
        tint: AppColors.secondaryContainer,
      ),
      _Metric(
        label: 'OVERDUE',
        value: '${followUpsController.overdue(now).length}',
        caption: 'Requires action',
        tint: AppColors.warningContainer,
        danger: true,
      ),
      _Metric(
        label: 'UPCOMING',
        value: '${followUpsController.upcoming(now).length}',
        caption: 'Later dates',
        tint: AppColors.surfaceContainerHigh,
      ),
      _Metric(
        label: 'CONVERSION FROM FOLLOW UPS',
        value: '${followUpsController.conversionPercent}%',
        caption: '${followUpsController.convertedToQuotes} to quotes · '
            '${followUpsController.convertedToOrders} orders',
        tint: AppColors.secondaryContainer,
      ),
    ];

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 6),
      child: Row(
        children: [
          for (var i = 0; i < tiles.length; i++) ...[
            if (i > 0) const SizedBox(width: 10),
            tiles[i],
          ],
        ],
      ),
    );
  }

  Widget _tabs(DateTime now) {
    return Container(
      margin: const EdgeInsets.only(top: 12),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: _hairline)),
      ),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        child: Row(
          children: [
            for (final tab in FollowUpTab.values)
              _TabButton(
                label: '${tab.label} (${followUpsController.tabCount(tab, now)})',
                selected: _tab == tab,
                onTap: () => setState(() => _tab = tab),
              ),
          ],
        ),
      ),
    );
  }

  Widget _search() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      child: TextField(
        controller: _searchController,
        style: const TextStyle(fontSize: 14),
        onChanged: (v) => followUpsController.query = v,
        decoration: InputDecoration(
          hintText: 'Search leads, phone, notes…',
          isDense: true,
          prefixIcon: const Icon(Icons.search, size: 18),
          filled: true,
          fillColor: AppColors.surfaceContainerLowest,
          contentPadding:
              const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: const BorderSide(color: AppColors.outlineVariant),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(8),
            borderSide: const BorderSide(color: AppColors.outlineVariant),
          ),
        ),
      ),
    );
  }

  List<Widget> _listSlivers(DateTime now) {
    final items = followUpsController.forTab(_tab, now);
    if (items.isEmpty) {
      return [
        SliverToBoxAdapter(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 28, 16, 0),
            child: Text(
              followUpsController.query.isNotEmpty
                  ? 'No follow-ups match your search.'
                  : switch (_tab) {
                      FollowUpTab.overdue => 'Nothing overdue. Well done.',
                      FollowUpTab.dueToday => 'Nothing scheduled today.',
                      FollowUpTab.all => 'No follow-ups scheduled yet.',
                    },
              style: const TextStyle(
                fontSize: 14,
                color: AppColors.onSurfaceVariant,
              ),
            ),
          ),
        ),
      ];
    }

    // Flat chronological list per tab (matches the web). Overdue entries sort
    // first (earliest dateTime) and are visually flagged.
    return [
      SliverPadding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
        sliver: SliverList.list(
          children: [
            for (final f in items)
              _FollowUpCard(
                followUp: f,
                now: now,
                overdue: f.isOverdue(now),
                onTap: () => _openLead(f),
              ),
          ],
        ),
      ),
    ];
  }
}

// ── Metric tile ────────────────────────────────────────────────────────────

class _Metric extends StatelessWidget {
  final String label;
  final String value;
  final String caption;
  final Color tint;
  final bool danger;

  const _Metric({
    required this.label,
    required this.value,
    required this.caption,
    required this.tint,
    this.danger = false,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 158,
      height: 82,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Container(
                width: 22,
                height: 22,
                decoration: BoxDecoration(
                  color: tint,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Icon(
                  Icons.event_note_outlined,
                  size: 13,
                  color: danger ? AppColors.warning : AppColors.primary,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontFamily: _mono,
                    fontSize: 9,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 0.6,
                    color: AppColors.outline,
                  ),
                ),
              ),
            ],
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                value,
                style: TextStyle(
                  fontSize: 20,
                  height: 1,
                  fontWeight: FontWeight.bold,
                  color: danger ? AppColors.error : AppColors.onSurface,
                ),
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  caption,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 10, color: AppColors.outline),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _TabButton extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _TabButton({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
        margin: const EdgeInsets.only(right: 8),
        decoration: BoxDecoration(
          border: Border(
            bottom: BorderSide(
              color: selected ? AppColors.primary : Colors.transparent,
              width: 2,
            ),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
            color: selected ? AppColors.primary : AppColors.outline,
          ),
        ),
      ),
    );
  }
}

class _FollowUpCard extends StatelessWidget {
  final FollowUp followUp;
  final DateTime now;
  final bool overdue;
  final VoidCallback onTap;

  const _FollowUpCard({
    required this.followUp,
    required this.now,
    required this.overdue,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final ref = followUp.relatedRef;
    final isOrder = ref != null && ref.toLowerCase().contains('order');
    final leadingText = overdue
        ? '${overdueLabel(followUp.dateTime, now)} · ${formatTime(followUp.dateTime)}'
        : formatTime(followUp.dateTime);

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: AppColors.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(10),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: overdue
                    ? AppColors.error.withValues(alpha: 0.45)
                    : AppColors.outlineVariant,
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          if (overdue) ...[
                            const Icon(Icons.error_outline,
                                size: 13, color: AppColors.error),
                            const SizedBox(width: 5),
                          ],
                          Text(
                            leadingText,
                            style: TextStyle(
                              fontFamily: _mono,
                              fontSize: 12,
                              fontWeight: FontWeight.w700,
                              color:
                                  overdue ? AppColors.error : AppColors.primary,
                            ),
                          ),
                          if (followUp.highPriority && !overdue) ...[
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                  horizontal: 6, vertical: 1),
                              decoration: BoxDecoration(
                                color: AppColors.warningContainer,
                                borderRadius: BorderRadius.circular(5),
                              ),
                              child: const Text(
                                'HIGH',
                                style: TextStyle(
                                  fontFamily: _mono,
                                  fontSize: 9,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.warning,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        followUp.customerName,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          color: AppColors.onSurface,
                        ),
                      ),
                      Text(
                        '${followUp.company} · ${followUp.phone}',
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        followUp.action,
                        style: const TextStyle(
                          fontSize: 13,
                          height: 1.4,
                          color: AppColors.onSurface,
                        ),
                      ),
                      if (ref != null) ...[
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            Icon(
                              isOrder
                                  ? Icons.inventory_2_outlined
                                  : Icons.receipt_long_outlined,
                              size: 13,
                              color: AppColors.outline,
                            ),
                            const SizedBox(width: 5),
                            Text(
                              ref,
                              style: const TextStyle(
                                fontFamily: _mono,
                                fontSize: 11,
                                color: AppColors.outline,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                const Icon(Icons.chevron_right,
                    size: 16, color: AppColors.outline),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

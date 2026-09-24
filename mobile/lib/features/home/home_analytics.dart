import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_typography.dart';
import '../crm/models/lead.dart';

class ChartSlice {
  const ChartSlice(this.label, this.count, this.color);

  final String label;
  final int count;
  final Color color;
}

/// Pipeline bar, win ring, plus follow-up / quote / invoice circular charts.
class HomeAnalytics extends StatelessWidget {
  const HomeAnalytics({
    super.key,
    required this.counts,
    required this.totalLeads,
    required this.won,
    required this.revenue,
    required this.winRatePercent,
    required this.closedCount,
    required this.followUpSlices,
    required this.quotationSlices,
    required this.invoiceSlices,
  });

  final Map<LeadStage, int> counts;
  final int totalLeads;
  final int won;
  final double revenue;
  final int? winRatePercent;
  final int closedCount;
  final List<ChartSlice> followUpSlices;
  final List<ChartSlice> quotationSlices;
  final List<ChartSlice> invoiceSlices;

  static const _stageColors = <LeadStage, Color>{
    LeadStage.newLead: Color(0xFF7C8CA1),
    LeadStage.contacted: Color(0xFF0F766E),
    LeadStage.requirementCollected: Color(0xFF0B5C56),
    LeadStage.quoted: Color(0xFFB45309),
    LeadStage.negotiation: Color(0xFFD97706),
    LeadStage.sample: Color(0xFF3D7A5A),
    LeadStage.won: Color(0xFF1F7A4D),
    LeadStage.lost: Color(0xFFB42318),
  };

  @override
  Widget build(BuildContext context) {
    final segments = [
      for (final stage in LeadStage.values)
        if ((counts[stage] ?? 0) > 0)
          ChartSlice(stage.label, counts[stage]!, _stageColors[stage]!),
    ];

    final followTotal =
        followUpSlices.fold<int>(0, (sum, s) => sum + s.count);
    final quoteTotal =
        quotationSlices.fold<int>(0, (sum, s) => sum + s.count);
    final invoiceTotal =
        invoiceSlices.fold<int>(0, (sum, s) => sum + s.count);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Overview', style: AppTypography.title(fontSize: 18)),
        const SizedBox(height: 4),
        Text(
          'Pipeline, follow-ups, and documents at a glance',
          style: AppTypography.caption(fontSize: 13),
        ),
        const SizedBox(height: 14),
        _Panel(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Pipeline', style: AppTypography.body(fontWeight: FontWeight.w500)),
              const SizedBox(height: 12),
              _StackedBar(segments: segments, total: totalLeads),
              const SizedBox(height: 14),
              if (segments.isEmpty)
                Text(
                  'No leads yet. The bar fills as people enter the pipeline.',
                  style: AppTypography.caption(fontSize: 13),
                )
              else
                Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  children: [
                    for (final segment in segments) _LegendDot(segment: segment),
                  ],
                ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        Row(
          children: [
            Expanded(
              child: _StatCard(
                label: 'Leads',
                value: '$totalLeads',
                caption: 'In the pipeline',
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _StatCard(
                label: 'Won',
                value: '$won',
                caption: formatInr(revenue),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _DonutCard(
                title: 'Win rate',
                centerLabel: winRatePercent == null ? '—' : '$winRatePercent%',
                slices: [
                  if (winRatePercent != null) ...[
                    ChartSlice('Won', won, AppColors.primary),
                    ChartSlice(
                      'Lost',
                      math.max(0, closedCount - won),
                      AppColors.outlineVariant,
                    ),
                  ],
                ],
                caption: winRatePercent == null
                    ? 'Shows once a lead is won or lost'
                    : '$closedCount closed · $won won',
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _DonutCard(
                title: 'Follow-ups',
                centerLabel: '$followTotal',
                slices: followUpSlices,
                caption: followTotal == 0
                    ? 'Nothing scheduled'
                    : 'Due, overdue & upcoming',
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: _DonutCard(
                title: 'Quotations',
                centerLabel: '$quoteTotal',
                slices: quotationSlices,
                caption: quoteTotal == 0
                    ? 'No open quotations'
                    : 'By document status',
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _DonutCard(
                title: 'Invoices',
                centerLabel: '$invoiceTotal',
                slices: invoiceSlices,
                caption: invoiceTotal == 0
                    ? 'No invoices yet'
                    : 'Converted documents',
              ),
            ),
          ],
        ),
      ],
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 14),
      decoration: BoxDecoration(
        color: AppColors.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.outlineVariant.withValues(alpha: 0.7)),
      ),
      child: child,
    );
  }
}

class _StackedBar extends StatelessWidget {
  const _StackedBar({required this.segments, required this.total});

  final List<ChartSlice> segments;
  final int total;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(99),
      child: SizedBox(
        height: 12,
        child: total == 0
            ? const ColoredBox(color: AppColors.surfaceContainer)
            : Row(
                children: [
                  for (final segment in segments)
                    Expanded(
                      flex: segment.count,
                      child: ColoredBox(color: segment.color),
                    ),
                ],
              ),
      ),
    );
  }
}

class _LegendDot extends StatelessWidget {
  const _LegendDot({required this.segment});

  final ChartSlice segment;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 7,
          height: 7,
          decoration: BoxDecoration(color: segment.color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Text(
          '${segment.label} ${segment.count}',
          style: AppTypography.caption(fontSize: 12),
        ),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({
    required this.label,
    required this.value,
    required this.caption,
  });

  final String label;
  final String value;
  final String caption;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
      decoration: BoxDecoration(
        color: AppColors.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.outlineVariant.withValues(alpha: 0.7)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: AppTypography.caption()),
          const SizedBox(height: 6),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTypography.heading(fontSize: 28),
          ),
          const SizedBox(height: 4),
          Text(
            caption,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppTypography.caption(fontSize: 12),
          ),
        ],
      ),
    );
  }
}

class _DonutCard extends StatelessWidget {
  const _DonutCard({
    required this.title,
    required this.centerLabel,
    required this.slices,
    required this.caption,
  });

  final String title;
  final String centerLabel;
  final List<ChartSlice> slices;
  final String caption;

  @override
  Widget build(BuildContext context) {
    final total = slices.fold<int>(0, (sum, s) => sum + s.count);
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 14, 12, 12),
      decoration: BoxDecoration(
        color: AppColors.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppColors.outlineVariant.withValues(alpha: 0.7)),
      ),
      child: Column(
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: Text(
              title,
              style: AppTypography.body(
                fontSize: 13,
                fontWeight: FontWeight.w500,
                color: AppColors.onSurfaceVariant,
              ),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: 92,
            height: 92,
            child: CustomPaint(
              painter: _DonutPainter(slices: slices, total: total),
              child: Center(
                child: Text(
                  centerLabel,
                  style: AppTypography.heading(
                    fontSize: 20,
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: 10),
          Text(
            caption,
            textAlign: TextAlign.center,
            style: AppTypography.caption(fontSize: 11),
          ),
          if (total > 0) ...[
            const SizedBox(height: 8),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 8,
              runSpacing: 4,
              children: [
                for (final slice in slices.where((s) => s.count > 0))
                  _LegendDot(segment: slice),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _DonutPainter extends CustomPainter {
  _DonutPainter({required this.slices, required this.total});

  final List<ChartSlice> slices;
  final int total;

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final radius = math.min(size.width, size.height) / 2 - 3;
    final track = Paint()
      ..color = AppColors.surfaceContainer
      ..style = PaintingStyle.stroke
      ..strokeWidth = 9
      ..strokeCap = StrokeCap.butt;

    canvas.drawCircle(center, radius, track);

    if (total <= 0) return;

    var start = -math.pi / 2;
    for (final slice in slices) {
      if (slice.count <= 0) continue;
      final sweep = (slice.count / total) * math.pi * 2;
      final paint = Paint()
        ..color = slice.color
        ..style = PaintingStyle.stroke
        ..strokeWidth = 9
        ..strokeCap = StrokeCap.butt;
      canvas.drawArc(
        Rect.fromCircle(center: center, radius: radius),
        start,
        sweep,
        false,
        paint,
      );
      start += sweep;
    }
  }

  @override
  bool shouldRepaint(covariant _DonutPainter oldDelegate) =>
      oldDelegate.total != total || oldDelegate.slices != slices;
}

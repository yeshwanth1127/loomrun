import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/theme/app_colors.dart';
import '../../core/theme/app_typography.dart';
import 'follow_ups_controller.dart';
import 'lead_details_screen.dart';
import 'leads_controller.dart';
import 'models/follow_up.dart';
import 'models/lead.dart';
import 'telecaller_repository.dart';

const _mono = 'monospace';

Future<void> _openPhoneApp(BuildContext context, String phone) async {
  final number = phone.replaceAll(RegExp(r'[^\d+]'), '');
  if (number.isEmpty) return;
  var opened = false;
  try {
    opened = await launchUrl(
      Uri.parse('tel:$number'),
      mode: LaunchMode.externalApplication,
    );
  } catch (_) {
    opened = false;
  }
  if (!opened && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Could not open the phone app.')),
    );
  }
}

/// Telecaller call queue — today's + overdue follow-ups from the live API.
class TelecallerScreen extends StatefulWidget {
  const TelecallerScreen({super.key});

  @override
  State<TelecallerScreen> createState() => _TelecallerScreenState();
}

class _TelecallerScreenState extends State<TelecallerScreen> {
  int _totalCallsToday = 0;
  bool _loadingSummary = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (!followUpsController.loadedOnce) {
        followUpsController.refresh();
      }
      _loadSummary();
    });
  }

  Future<void> _loadSummary() async {
    setState(() => _loadingSummary = true);
    try {
      final today = DateTime.now();
      final day =
          '${today.year.toString().padLeft(4, '0')}-'
          '${today.month.toString().padLeft(2, '0')}-'
          '${today.day.toString().padLeft(2, '0')}';
      final data = await telecallerRepository.dailySummary(day: day);
      if (!mounted) return;
      setState(() {
        _totalCallsToday = (data['total_calls'] as num?)?.toInt() ?? 0;
        _loadingSummary = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _loadingSummary = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: () async {
            await followUpsController.refresh();
            await _loadSummary();
          },
          child: ListenableBuilder(
            listenable: Listenable.merge([
              followUpsController,
              leadsController,
            ]),
            builder: (context, _) {
              final now = DateTime.now();
              final queue = [
                ...followUpsController.overdue(now),
                ...followUpsController.dueToday(now),
              ];

              return CustomScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                slivers: [
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Calls',
                            style: AppTypography.heading(fontSize: 26),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            queue.isEmpty
                                ? 'No calls in the queue right now.'
                                : '${queue.length} '
                                      '${queue.length == 1 ? "call" : "calls"} '
                                      'to work through.',
                            style: const TextStyle(
                              fontSize: 14,
                              color: AppColors.onSurfaceVariant,
                            ),
                          ),
                          if (_loadingSummary || _totalCallsToday > 0) ...[
                            const SizedBox(height: 8),
                            Text(
                              _loadingSummary
                                  ? 'Loading today\'s call summary…'
                                  : '$_totalCallsToday calls logged today',
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.outline,
                              ),
                            ),
                          ],
                          if (followUpsController.error != null) ...[
                            const SizedBox(height: 8),
                            Text(
                              followUpsController.error!,
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.error,
                              ),
                            ),
                          ],
                          const SizedBox(height: 16),
                        ],
                      ),
                    ),
                  ),
                  if (followUpsController.loading && queue.isEmpty)
                    const SliverFillRemaining(
                      hasScrollBody: false,
                      child: Center(child: CircularProgressIndicator()),
                    )
                  else if (queue.isEmpty)
                    const SliverToBoxAdapter(
                      child: Padding(
                        padding: EdgeInsets.fromLTRB(16, 24, 16, 0),
                        child: Text(
                          'Follow-ups due today and overdue follow-ups will show '
                          'up here as a call list.',
                          style: TextStyle(
                            fontSize: 13,
                            height: 1.5,
                            color: AppColors.onSurfaceVariant,
                          ),
                        ),
                      ),
                    )
                  else
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                      sliver: SliverList.separated(
                        itemCount: queue.length,
                        separatorBuilder: (_, _) => const SizedBox(height: 10),
                        itemBuilder: (_, i) => _CallCard(
                          followUp: queue[i],
                          overdue: queue[i].isOverdue(now),
                          now: now,
                        ),
                      ),
                    ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

class _CallCard extends StatelessWidget {
  final FollowUp followUp;
  final bool overdue;
  final DateTime now;

  const _CallCard({
    required this.followUp,
    required this.overdue,
    required this.now,
  });

  void _openLead(BuildContext context) {
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
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (_) => LeadDetailsScreen(lead: lead)));
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.surfaceContainerLowest,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: () => _openLead(context),
        borderRadius: BorderRadius.circular(12),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.outlineVariant),
          ),
          padding: const EdgeInsets.all(14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: overdue
                      ? AppColors.error.withValues(alpha: 0.12)
                      : AppColors.primary.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(
                  Icons.phone_in_talk_outlined,
                  size: 20,
                  color: overdue ? AppColors.error : AppColors.primary,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      followUp.customerName,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.onSurface,
                      ),
                    ),
                    if (followUp.company.isNotEmpty)
                      Text(
                        followUp.company,
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppColors.onSurfaceVariant,
                        ),
                      ),
                    const SizedBox(height: 4),
                    Text(
                      followUp.action,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      overdue
                          ? overdueLabel(followUp.dateTime, now)
                          : formatTime(followUp.dateTime),
                      style: TextStyle(
                        fontFamily: _mono,
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: overdue ? AppColors.error : AppColors.primary,
                      ),
                    ),
                  ],
                ),
              ),
              if (followUp.phone.isNotEmpty)
                IconButton(
                  onPressed: () => _openPhoneApp(context, followUp.phone),
                  style: IconButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: Colors.white,
                    fixedSize: const Size(40, 40),
                  ),
                  icon: const Icon(Icons.call, size: 20),
                  tooltip: 'Call ${followUp.phone}',
                ),
            ],
          ),
        ),
      ),
    );
  }
}

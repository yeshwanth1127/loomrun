import 'package:flutter/material.dart';

import 'core/auth/auth.dart';
import 'core/config/dev_config.dart';
import 'core/theme/app_colors.dart';
import 'core/theme/app_typography.dart';
import 'core/widgets/app_logo.dart';
import 'features/auth/auth_screen.dart';
import 'features/crm/follow_ups_controller.dart';
import 'features/crm/follow_ups_screen.dart';
import 'features/crm/leads_controller.dart';
import 'features/crm/leads_screen.dart';
import 'features/crm/models/follow_up.dart';
import 'features/crm/models/lead.dart';
import 'features/crm/telecaller_screen.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await authController.init();
  await applyDevAuthBypass(); // dev-only; no-op when kBypassAuth is false
  runApp(const LoomRunApp());
}

const _mono = 'monospace';

class LoomRunApp extends StatelessWidget {
  const LoomRunApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Loom Run',
      theme: ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(
          seedColor: AppColors.primary,
          surface: AppColors.surface,
        ),
        scaffoldBackgroundColor: AppColors.surface,
        fontFamily: 'Roboto',
      ),
      home: ListenableBuilder(
        listenable: authController,
        builder: (context, _) =>
            authController.isAuthenticated ? const MainApp() : const AuthScreen(),
      ),
    );
  }
}

class MainApp extends StatefulWidget {
  const MainApp({super.key});

  @override
  State<MainApp> createState() => _MainAppState();
}

class _MainAppState extends State<MainApp> {
  /// 0 Home · 1 Ask AI · 2 Telecaller
  int currentIndex = 0;

  final List<Widget> pages = const [
    HomePage(),
    PlaceholderPage(title: 'Ask AI'),
    TelecallerScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.surface,
      body: IndexedStack(
        index: currentIndex,
        children: pages,
      ),
      bottomNavigationBar: _PrimaryBottomNav(
        currentIndex: currentIndex,
        onSelect: (index) => setState(() => currentIndex = index),
      ),
    );
  }
}

/// Primary mobile nav: Home | Ask AI | Telecaller.
/// Ask AI is always the filled teal center action; Home and Telecaller stay
/// muted (outline) and only pick up a light selected tint — never the filled
/// Ask AI treatment.
class _PrimaryBottomNav extends StatelessWidget {
  final int currentIndex;
  final ValueChanged<int> onSelect;

  const _PrimaryBottomNav({
    required this.currentIndex,
    required this.onSelect,
  });

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(
          top: BorderSide(color: Color(0x4DE5E9EE)),
        ),
      ),
      padding: EdgeInsets.only(bottom: bottomInset),
      child: SizedBox(
        height: 64,
        child: Row(
          children: [
            Expanded(
              child: _SideNavItem(
                icon: currentIndex == 0 ? Icons.home : Icons.home_outlined,
                label: 'Home',
                selected: currentIndex == 0,
                onTap: () => onSelect(0),
              ),
            ),
            Expanded(
              child: _AskAiNavItem(
                onTap: () => onSelect(1),
              ),
            ),
            Expanded(
              child: _SideNavItem(
                icon: currentIndex == 2
                    ? Icons.phone_in_talk
                    : Icons.phone_in_talk_outlined,
                label: 'Telecaller',
                selected: currentIndex == 2,
                onTap: () => onSelect(2),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SideNavItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _SideNavItem({
    required this.icon,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = selected ? AppColors.primary : AppColors.outline;
    return InkWell(
      onTap: onTap,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, size: 22, color: color),
          const SizedBox(height: 4),
          Text(
            label,
            style: TextStyle(
              fontFamily: _mono,
              fontSize: 10,
              fontWeight: selected ? FontWeight.w600 : FontWeight.w400,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

/// Filled teal center tab — always visually primary, never muted.
class _AskAiNavItem extends StatelessWidget {
  final VoidCallback onTap;

  const _AskAiNavItem({
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(24),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            color: AppColors.primary,
            borderRadius: BorderRadius.circular(24),
          ),
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.auto_awesome, size: 16, color: Colors.white),
              SizedBox(width: 6),
              Text(
                'Ask AI',
                style: TextStyle(
                  fontFamily: _mono,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: Colors.white,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String _ddMmYyyy(DateTime d) {
  String two(int n) => n.toString().padLeft(2, '0');
  return '${two(d.day)}-${two(d.month)}-${d.year}';
}

bool _isSameCalendarDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  /// Defaults to today; updated via the date picker.
  DateTime _asOfDate = DateTime.now();

  String _greeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  void _open(BuildContext context, Widget page) {
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => page));
  }

  Future<void> _pickDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _asOfDate,
      firstDate: DateTime(now.year - 5),
      lastDate: DateTime(now.year + 5),
    );
    if (picked != null) setState(() => _asOfDate = picked);
  }

  /// Follow-ups scheduled on the selected calendar day.
  List<FollowUp> _followUpsForDate() {
    return followUpsController.all
        .where((f) => sameDay(f.dateTime, _asOfDate))
        .toList();
  }

  String get _followUpsSubtitle {
    if (_isSameCalendarDay(_asOfDate, DateTime.now())) {
      return 'Scheduled for today';
    }
    return 'Scheduled for ${_ddMmYyyy(_asOfDate)}';
  }

  @override
  Widget build(BuildContext context) {
    final user = authController.currentUser!;

    final dueFollowUps = _followUpsForDate();
    final newLeads = leadsController.filtered(stage: LeadStage.newLead);
    final wonLeads = leadsController.filtered(stage: LeadStage.won);
    final closedCount = leadsController.closedCount;
    final revenue = wonLeads.fold<double>(0, (sum, l) => sum + l.value);
    final winRatePercent =
        closedCount > 0 ? (wonLeads.length / closedCount * 100).round() : null;

    // How many of the six attention sections currently have something to
    // act on — mirrors the website's "N things need your attention." line.
    final needingAttention =
        [dueFollowUps.length, newLeads.length].where((c) => c > 0).length;

    return Column(
      children: [
        const _LoomHeader(),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
            children: [
              _DateSelector(
                date: _asOfDate,
                onPickDate: _pickDate,
              ),
              const SizedBox(height: 16),
              Text(
                '${_greeting()}, ${user.firstName}',
                style: AppTypography.heading(fontSize: 28),
              ),
              const SizedBox(height: 4),
              Text(
                '$needingAttention '
                '${needingAttention == 1 ? 'thing needs' : 'things need'} '
                'your attention.',
                style: const TextStyle(
                  fontSize: 14,
                  color: AppColors.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 20),

              _AttentionCard(
                icon: Icons.event_note_outlined,
                accent: AppColors.primary,
                title: 'Follow-ups due',
                count: dueFollowUps.length,
                subtitle: _followUpsSubtitle,
                statusText: 'No follow-ups due',
                records: [
                  for (final f in dueFollowUps.take(1))
                    _AttentionRecord(
                      primary: f.customerName,
                      secondary: f.company,
                      trailing: formatTime(f.dateTime),
                    ),
                ],
                actionLabel: 'Open follow-ups',
                onAction: () => _open(context, const FollowUpsScreen()),
              ),
              _AttentionCard(
                icon: Icons.person_add_alt_outlined,
                accent: AppColors.warning,
                title: 'New leads',
                count: newLeads.length,
                subtitle: 'Not contacted yet',
                statusText: 'No new leads',
                records: [
                  for (final l in newLeads.take(1))
                    _AttentionRecord(
                      primary: l.name,
                      secondary: l.company,
                      trailing: formatRelative(l.lastActivity),
                    ),
                ],
                actionLabel: 'Open new leads',
                onAction: () => _open(context, const LeadsScreen()),
              ),
              _AttentionCard(
                icon: Icons.receipt_long_outlined,
                accent: AppColors.warning,
                title: 'Quotations waiting',
                count: 0,
                subtitle: 'Drafts waiting to be sent',
                statusText: 'No drafts to send',
                records: const [],
                actionLabel: 'Open quotations',
                onAction: () =>
                    _open(context, const PlaceholderPage(title: 'Quotations')),
              ),
              _AttentionCard(
                icon: Icons.inventory_2_outlined,
                accent: AppColors.onSurfaceVariant,
                title: 'Orders needing attention',
                count: 0,
                subtitle: 'On hold, payment hold, or past dispatch date',
                statusText: 'Every order is moving',
                records: const [],
                actionLabel: 'Open orders',
                onAction: () =>
                    _open(context, const PlaceholderPage(title: 'Orders')),
              ),
              _AttentionCard(
                icon: Icons.precision_manufacturing_outlined,
                accent: AppColors.success,
                title: 'Delayed production',
                count: 0,
                subtitle: 'Flagged as delayed',
                statusText: 'Nothing is running late',
                records: const [],
                actionLabel: 'Open delayed orders',
                onAction: () => _open(
                    context, const PlaceholderPage(title: 'Delayed Orders')),
              ),
              _AttentionCard(
                icon: Icons.currency_rupee_outlined,
                accent: AppColors.success,
                title: 'Money to collect',
                count: 0,
                subtitle: 'All settled',
                statusText: 'Nothing outstanding',
                records: const [],
                actionLabel: 'Open money',
                onAction: () =>
                    _open(context, const PlaceholderPage(title: 'Money')),
              ),

              const SizedBox(height: 12),
              const Padding(
                padding: EdgeInsets.only(bottom: 12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Text(
                      'Business',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w700,
                        color: AppColors.onSurface,
                      ),
                    ),
                    SizedBox(width: 6),
                    Text(
                      '· All time',
                      style: TextStyle(
                        fontSize: 13,
                        color: AppColors.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                mainAxisSpacing: 10,
                crossAxisSpacing: 10,
                childAspectRatio: 1.7,
                children: [
                  _BusinessTile(
                    label: 'LEADS',
                    value: '${leadsController.totalCount}',
                    caption: 'All time',
                  ),
                  _BusinessTile(
                    label: 'ORDERS WON',
                    value: '${wonLeads.length}',
                    caption: formatInr(revenue),
                  ),
                  _BusinessTile(
                    label: 'WIN RATE',
                    value:
                        winRatePercent == null ? '—' : '$winRatePercent%',
                    caption: '$closedCount closed',
                  ),
                  _BusinessTile(
                    label: 'REVENUE',
                    value: formatInr(revenue),
                    caption: 'Confirmed orders',
                  ),
                  const _BusinessTile(
                    label: 'MARGIN',
                    value: '—',
                    caption: 'Revenue less spend',
                  ),
                  const _BusinessTile(
                    label: 'COLLECTIONS PENDING',
                    value: '0',
                    caption: '—',
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Date selector above the greeting. Defaults to today; opens a date picker.
/// Scopes Follow-ups due to the selected calendar day.
class _DateSelector extends StatelessWidget {
  final DateTime date;
  final VoidCallback onPickDate;

  const _DateSelector({
    required this.date,
    required this.onPickDate,
  });

  @override
  Widget build(BuildContext context) {
    final isToday = _isSameCalendarDay(date, DateTime.now());
    return Align(
      alignment: Alignment.centerLeft,
      child: InkWell(
        onTap: onPickDate,
        borderRadius: BorderRadius.circular(10),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: AppColors.surfaceContainerLowest,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: AppColors.outlineVariant),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.calendar_today_outlined,
                size: 15,
                color: AppColors.primary,
              ),
              const SizedBox(width: 8),
              Text(
                isToday ? 'Today · ${_ddMmYyyy(date)}' : _ddMmYyyy(date),
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.onSurface,
                ),
              ),
              const SizedBox(width: 6),
              const Icon(
                Icons.expand_more,
                size: 18,
                color: AppColors.onSurfaceVariant,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One line of "who/what" under an attention card — a due follow-up, a new
/// lead, etc. Mirrors the website's record row (name + context, time-ago).
class _AttentionRecord {
  final String primary;
  final String secondary;
  final String trailing;

  const _AttentionRecord({
    required this.primary,
    required this.secondary,
    required this.trailing,
  });
}

/// One of the website Home's six attention cards, adapted into a compact
/// full-width mobile card: icon + title + count, a subtitle, either the
/// top record or a zero-state status line, and a footer "Open …" action.
class _AttentionCard extends StatelessWidget {
  final IconData icon;
  final Color accent;
  final String title;
  final int count;
  final String subtitle;
  final String statusText;
  final List<_AttentionRecord> records;
  final String actionLabel;
  final VoidCallback onAction;

  const _AttentionCard({
    required this.icon,
    required this.accent,
    required this.title,
    required this.count,
    required this.subtitle,
    required this.statusText,
    required this.records,
    required this.actionLabel,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: AppColors.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.outlineVariant),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          IntrinsicHeight(
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
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.center,
                          children: [
                            Container(
                              width: 30,
                              height: 30,
                              decoration: BoxDecoration(
                                color: AppColors.surfaceContainer,
                                borderRadius: BorderRadius.circular(8),
                              ),
                              child: Icon(icon, size: 16, color: accent),
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.onSurface,
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Text(
                              '$count',
                              style: const TextStyle(
                                fontSize: 20,
                                fontWeight: FontWeight.w700,
                                height: 1,
                                color: AppColors.onSurface,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Text(
                          subtitle,
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.onSurfaceVariant,
                          ),
                        ),
                        const SizedBox(height: 10),
                        if (records.isEmpty)
                          Row(
                            children: [
                              Icon(Icons.check_circle_outline,
                                  size: 14, color: accent),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  statusText,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: AppColors.onSurfaceVariant,
                                  ),
                                ),
                              ),
                            ],
                          )
                        else
                          for (final r in records)
                            Padding(
                              padding: const EdgeInsets.only(top: 2),
                              child: Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Expanded(
                                    child: Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: [
                                        Text(
                                          r.primary,
                                          maxLines: 1,
                                          overflow: TextOverflow.ellipsis,
                                          style: const TextStyle(
                                            fontSize: 13,
                                            fontWeight: FontWeight.w600,
                                            color: AppColors.onSurface,
                                          ),
                                        ),
                                        if (r.secondary.isNotEmpty)
                                          Text(
                                            r.secondary,
                                            maxLines: 1,
                                            overflow: TextOverflow.ellipsis,
                                            style: const TextStyle(
                                              fontSize: 12,
                                              color: AppColors.onSurfaceVariant,
                                            ),
                                          ),
                                      ],
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Text(
                                    r.trailing,
                                    style: const TextStyle(
                                      fontSize: 11,
                                      color: AppColors.outline,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          Material(
            color: AppColors.surfaceContainer,
            child: InkWell(
              onTap: onAction,
              child: Padding(
                padding: const EdgeInsets.symmetric(
                    horizontal: 15, vertical: 10),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        actionLabel,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: accent,
                        ),
                      ),
                    ),
                    Icon(Icons.arrow_forward, size: 14, color: accent),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// One tile in the "Business · All time" grid.
class _BusinessTile extends StatelessWidget {
  final String label;
  final String value;
  final String caption;

  const _BusinessTile({
    required this.label,
    required this.value,
    required this.caption,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.surfaceContainerLowest,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.outlineVariant),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            label,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 10.5,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.4,
              color: AppColors.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 19,
              fontWeight: FontWeight.w700,
              color: AppColors.onSurface,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            caption,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 11,
              color: AppColors.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }
}

class _LoomHeader extends StatelessWidget {
  const _LoomHeader();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(
          bottom: BorderSide(color: Color(0x4DE5E9EE)),
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: SizedBox(
          height: 56,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                const AppLogo(height: 34),
                const Spacer(),
                Stack(
                  clipBehavior: Clip.none,
                  children: [
                    IconButton(
                      onPressed: () {},
                      visualDensity: VisualDensity.compact,
                      icon: const Icon(
                        Icons.notifications_none,
                        size: 20,
                        color: AppColors.onSurfaceVariant,
                      ),
                    ),
                    Positioned(
                      top: 8,
                      right: 8,
                      child: Container(
                        width: 6,
                        height: 6,
                        decoration: const BoxDecoration(
                          color: AppColors.error,
                          shape: BoxShape.circle,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(width: 4),
                PopupMenuButton<String>(
                  tooltip: 'Account',
                  offset: const Offset(0, 44),
                  onSelected: (value) {
                    if (value == 'logout') authController.logOut();
                  },
                  itemBuilder: (context) {
                    final user = authController.currentUser!;
                    return [
                      PopupMenuItem<String>(
                        enabled: false,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              user.fullName,
                              style: const TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                                color: AppColors.onSurface,
                              ),
                            ),
                            Text(
                              user.email,
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.onSurfaceVariant,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const PopupMenuDivider(),
                      const PopupMenuItem<String>(
                        value: 'logout',
                        child: Text('Log out'),
                      ),
                    ];
                  },
                  child: Text(
                    authController.currentUser!.initials,
                    style: const TextStyle(
                      fontFamily: _mono,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.primary,
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

class PlaceholderPage extends StatelessWidget {
  final String title;

  const PlaceholderPage({super.key, required this.title});

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                title,
                style: AppTypography.heading(fontSize: 28),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              const Text(
                'Coming soon.',
                style: TextStyle(
                  fontSize: 14,
                  color: AppColors.onSurfaceVariant,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

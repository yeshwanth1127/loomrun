import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import 'core/auth/auth.dart';
import 'core/config/dev_config.dart';
import 'core/theme/app_colors.dart';
import 'core/theme/app_typography.dart';
import 'core/widgets/app_logo.dart';
import 'features/auth/splash_screen.dart';
import 'features/crm/documents_repository.dart';
import 'features/crm/follow_ups_controller.dart';
import 'features/crm/follow_ups_screen.dart';
import 'features/crm/leads_controller.dart';
import 'features/crm/leads_screen.dart';
import 'features/crm/models/follow_up.dart';
import 'features/crm/models/lead.dart';
import 'features/ai/ask_ai_screen.dart';
import 'features/crm/telecaller_screen.dart';
import 'features/home/home_analytics.dart';
import 'features/settings/settings_screen.dart';

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
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: AppColors.primary,
        surface: AppColors.surface,
      ),
      scaffoldBackgroundColor: AppColors.surface,
    );
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Loom Run',
      theme: base.copyWith(
        textTheme: GoogleFonts.plusJakartaSansTextTheme(base.textTheme).apply(
          bodyColor: AppColors.onSurface,
          displayColor: AppColors.onSurface,
        ),
        primaryTextTheme:
            GoogleFonts.plusJakartaSansTextTheme(base.primaryTextTheme),
      ),
      home: ListenableBuilder(
        listenable: authController,
        builder: (context, _) => authController.isAuthenticated
            ? const MainApp()
            : const SplashGate(),
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
  /// 0 Home · 1 Ask AI · 2 Calls · 3 Settings
  int currentIndex = 0;

  final List<Widget> pages = const [
    HomePage(),
    AskAiScreen(),
    TelecallerScreen(),
    SettingsScreen(),
  ];

  @override
  Widget build(BuildContext context) {
    final index = currentIndex.clamp(0, pages.length - 1);
    return Scaffold(
      backgroundColor: AppColors.surface,
      body: IndexedStack(
        index: index,
        children: pages,
      ),
      bottomNavigationBar: _PrimaryBottomNav(
        currentIndex: index,
        onSelect: (next) => setState(() => currentIndex = next),
      ),
    );
  }
}

/// Floating bar. The selected item rises so half of it sits above the bar,
/// and the bar edge curves around it.
class _PrimaryBottomNav extends StatefulWidget {
  final int currentIndex;
  final ValueChanged<int> onSelect;

  const _PrimaryBottomNav({
    required this.currentIndex,
    required this.onSelect,
  });

  @override
  State<_PrimaryBottomNav> createState() => _PrimaryBottomNavState();
}

class _PrimaryBottomNavState extends State<_PrimaryBottomNav>
    with SingleTickerProviderStateMixin {
  static const _itemCount = 4;
  static const _circleRadius = 24.0;
  static const _barTop = _circleRadius;

  late final AnimationController _slide;
  late double _fromSlot;
  late double _toSlot;

  @override
  void initState() {
    super.initState();
    _fromSlot = widget.currentIndex.toDouble();
    _toSlot = _fromSlot;
    _slide = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 340),
      value: 1,
    );
  }

  double get _slot {
    final t = Curves.easeOutCubic.transform(_slide.value);
    return _fromSlot + (_toSlot - _fromSlot) * t;
  }

  @override
  void didUpdateWidget(covariant _PrimaryBottomNav oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.currentIndex == widget.currentIndex) return;
    _fromSlot = _slot;
    _toSlot = widget.currentIndex.toDouble();
    _slide.forward(from: 0);
  }

  @override
  void dispose() {
    _slide.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bottomInset = MediaQuery.paddingOf(context).bottom;
    const items = <_NavSpec>[
      _NavSpec(0, 'Home', Icons.home_outlined, Icons.home),
      _NavSpec(1, 'Ask', Icons.auto_awesome_outlined, Icons.auto_awesome),
      _NavSpec(2, 'Calls', Icons.phone_outlined, Icons.phone),
      _NavSpec(3, 'Settings', Icons.settings_outlined, Icons.settings),
    ];

    return Padding(
      padding: EdgeInsets.fromLTRB(16, 0, 16, 8 + bottomInset),
      child: SizedBox(
        height: _barTop + 64,
        child: LayoutBuilder(
          builder: (context, constraints) {
            final width = constraints.maxWidth;
            return AnimatedBuilder(
              animation: _slide,
              builder: (context, _) {
                final centerX = (_slot + 0.5) * width / _itemCount;
                return Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Positioned(
                      left: 0,
                      right: 0,
                      top: _barTop,
                      bottom: 0,
                      child: CustomPaint(
                        painter: _WaveBarPainter(notchCenterX: centerX),
                      ),
                    ),
                    Positioned(
                      left: 0,
                      right: 0,
                      top: _barTop,
                      bottom: 0,
                      child: Row(
                        children: [
                          for (final item in items)
                            _WaveNavItem(
                              spec: item,
                              selected: widget.currentIndex == item.index,
                              onTap: () => widget.onSelect(item.index),
                            ),
                        ],
                      ),
                    ),
                    Positioned(
                      left: centerX - _circleRadius,
                      top: 0,
                      child: IgnorePointer(
                        child: Container(
                          width: _circleRadius * 2,
                          height: _circleRadius * 2,
                          decoration: BoxDecoration(
                            color: AppColors.primary,
                            shape: BoxShape.circle,
                            border: Border.all(color: AppColors.surface, width: 3),
                            boxShadow: const [
                              BoxShadow(
                                color: Color(0x330F766E),
                                blurRadius: 10,
                                offset: Offset(0, 3),
                              ),
                            ],
                          ),
                          child: Icon(
                            items[widget.currentIndex.clamp(0, _itemCount - 1)].selectedIcon,
                            color: Colors.white,
                            size: 20,
                          ),
                        ),
                      ),
                    ),
                  ],
                );
              },
            );
          },
        ),
      ),
    );
  }
}

class _NavSpec {
  final int index;
  final String label;
  final IconData icon;
  final IconData selectedIcon;

  const _NavSpec(this.index, this.label, this.icon, this.selectedIcon);
}

class _WaveNavItem extends StatelessWidget {
  final _NavSpec spec;
  final bool selected;
  final VoidCallback onTap;

  const _WaveNavItem({
    required this.spec,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final color = selected ? AppColors.primary : AppColors.outline;
    return Expanded(
      child: InkWell(
        onTap: onTap,
        child: selected
            ? Align(
                alignment: Alignment.bottomCenter,
                child: Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Text(
                    spec.label,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: color,
                    ),
                  ),
                ),
              )
            : Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(spec.icon, size: 22, color: color),
                  const SizedBox(height: 2),
                  Text(
                    spec.label,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                      color: color,
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

class _WaveBarPainter extends CustomPainter {
  _WaveBarPainter({required this.notchCenterX});

  final double notchCenterX;

  @override
  void paint(Canvas canvas, Size size) {
    const dip = 28.0;
    const bottomCorner = 22.0;
    final cx = notchCenterX;
    var half = 36.0;
    final maxHalf = math.min(cx, size.width - cx);
    if (half > maxHalf) half = math.max(12.0, maxHalf);

    final leftFlat = math.max(0.0, cx - half);
    final rightLip = math.min(size.width, cx + half);
    final leftCorner = leftFlat.clamp(0.0, bottomCorner);
    final rightCorner = (size.width - rightLip).clamp(0.0, bottomCorner);

    final path = Path()
      ..moveTo(0, leftCorner)
      ..quadraticBezierTo(0, 0, leftCorner, 0)
      ..lineTo(leftFlat, 0)
      ..cubicTo(
        cx - half * 0.55,
        0,
        cx - half * 0.42,
        dip,
        cx,
        dip,
      )
      ..cubicTo(
        cx + half * 0.42,
        dip,
        cx + half * 0.55,
        0,
        rightLip,
        0,
      )
      ..lineTo(size.width - rightCorner, 0)
      ..quadraticBezierTo(size.width, 0, size.width, rightCorner)
      ..lineTo(size.width, size.height - bottomCorner)
      ..quadraticBezierTo(size.width, size.height, size.width - bottomCorner, size.height)
      ..lineTo(bottomCorner, size.height)
      ..quadraticBezierTo(0, size.height, 0, size.height - bottomCorner)
      ..close();

    canvas.drawShadow(path, const Color(0x330F172A), 8, true);
    canvas.drawPath(path, Paint()..color = AppColors.surfaceContainerLowest);
  }

  @override
  bool shouldRepaint(covariant _WaveBarPainter oldDelegate) =>
      oldDelegate.notchCenterX != notchCenterX;
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

class _HomePageState extends State<HomePage>
    with SingleTickerProviderStateMixin {
  /// Defaults to today; updated via the date picker.
  DateTime _asOfDate = DateTime.now();
  DocumentsSnapshot _documents = DocumentsSnapshot.empty;
  late final AnimationController _greetingController;
  late final Animation<double> _greetingFade;
  late final Animation<Offset> _greetingSlide;

  @override
  void initState() {
    super.initState();
    _greetingController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 420),
    );
    final curve = CurvedAnimation(
      parent: _greetingController,
      curve: Curves.easeOut,
    );
    _greetingFade = curve;
    _greetingSlide = Tween<Offset>(
      begin: const Offset(0.08, 0),
      end: Offset.zero,
    ).animate(curve);
    _greetingController.forward();
    leadsController.addListener(_onCrmChanged);
    followUpsController.addListener(_onCrmChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _refreshCrm();
    });
  }

  @override
  void dispose() {
    _greetingController.dispose();
    leadsController.removeListener(_onCrmChanged);
    followUpsController.removeListener(_onCrmChanged);
    super.dispose();
  }

  void _onCrmChanged() {
    if (!mounted) return;
    // Controllers may notify while another route is still building (e.g.
    // IndexedStack children). Defer so we never markNeedsBuild mid-build.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) setState(() {});
    });
  }

  Future<void> _refreshCrm() async {
    await Future.wait([
      leadsController.refresh(silent: leadsController.loadedOnce),
      followUpsController.refresh(silent: followUpsController.loadedOnce),
      _refreshDocuments(),
    ]);
  }

  Future<void> _refreshDocuments() async {
    try {
      final snap = await documentsRepository.fetchSnapshot();
      if (!mounted) return;
      setState(() => _documents = snap);
    } catch (_) {
      // Charts fall back to empty slices; attention cards stay usable.
    }
  }

  String _greeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  String _greetingLine(AppUser user) {
    final name = user.firstName;
    final hello = _greeting();
    if (name.isEmpty) return hello;
    return '$hello, $name';
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
    final now = DateTime.now();
    final overdueFollowUps = followUpsController.overdue(now);
    final dueTodayFollowUps = followUpsController.dueToday(now);
    final upcomingFollowUps = followUpsController.upcoming(now);

    // How many of the six attention sections currently have something to
    // act on — mirrors the website's "N things need your attention." line.
    final needingAttention =
        [dueFollowUps.length, newLeads.length].where((c) => c > 0).length;

    const quoteColors = {
      'DRAFT': Color(0xFF7C8CA1),
      'SENT': Color(0xFF0F766E),
      'ACCEPTED': Color(0xFF1F7A4D),
      'REJECTED': Color(0xFFB42318),
      'EXPIRED': Color(0xFFB45309),
      'INVOICED': Color(0xFF0B5C56),
    };

    return Column(
      children: [
        const _LoomHeader(),
        Expanded(
          child: RefreshIndicator(
            onRefresh: _refreshCrm,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 28),
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _DateSelector(
                    date: _asOfDate,
                    onPickDate: _pickDate,
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FadeTransition(
                      opacity: _greetingFade,
                      child: SlideTransition(
                        position: _greetingSlide,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text(
                              _greetingLine(user),
                              textAlign: TextAlign.right,
                              style: AppTypography.heading(fontSize: 28),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              '$needingAttention '
                              '${needingAttention == 1 ? 'thing needs' : 'things need'} '
                              'your attention.',
                              textAlign: TextAlign.right,
                              style: AppTypography.caption(fontSize: 13),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 22),
              HomeAnalytics(
                counts: {
                  for (final stage in LeadStage.values)
                    stage: leadsController.countForStage(stage),
                },
                totalLeads: leadsController.totalCount,
                won: wonLeads.length,
                revenue: revenue,
                winRatePercent: winRatePercent,
                closedCount: closedCount,
                followUpSlices: [
                  if (overdueFollowUps.isNotEmpty)
                    ChartSlice(
                      'Overdue',
                      overdueFollowUps.length,
                      AppColors.error,
                    ),
                  if (dueTodayFollowUps.isNotEmpty)
                    ChartSlice(
                      'Today',
                      dueTodayFollowUps.length,
                      AppColors.warning,
                    ),
                  if (upcomingFollowUps.isNotEmpty)
                    ChartSlice(
                      'Upcoming',
                      upcomingFollowUps.length,
                      AppColors.primary,
                    ),
                ],
                quotationSlices: [
                  for (final entry in _documents.quotationByStatus.entries)
                    if (entry.value > 0)
                      ChartSlice(
                        entry.key[0] + entry.key.substring(1).toLowerCase(),
                        entry.value,
                        quoteColors[entry.key] ?? AppColors.outline,
                      ),
                ],
                invoiceSlices: [
                  if (_documents.invoiceCount > 0)
                    ChartSlice(
                      'Invoices',
                      _documents.invoiceCount,
                      AppColors.success,
                    ),
                ],
              ),
              const SizedBox(height: 22),

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

            ],
          ),
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

import { useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Doughnut } from 'react-chartjs-2';
import { 
  DollarSign, Users, ShoppingCart, Activity, ShieldAlert, 
  Lock, Unlock, ArrowUpRight, BarChart3, PieChart, Layers, 
  Menu, X, CheckCircle, Database 
} from 'lucide-react';
import { dashboardData } from '../data/dashboardData';
import { useLanguage } from '../hooks/useLanguage';
import { useTheme } from '../hooks/useTheme';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export default function AdminDashboard() {
  const { t, isRtl } = useLanguage();
  const { isDark } = useTheme();

  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [activeTab, setActiveTab] = useState('overview'); // overview, orders, courses, tools
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Chart configuration with dark/light theme awareness
  const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
  const textColor = isDark ? '#94A3B8' : '#64748B';

  const lineChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
        labels: {
          color: textColor,
          font: { family: 'Inter', size: 12, weight: 600 }
        }
      },
      tooltip: {
        backgroundColor: '#060B18',
        titleColor: '#F5C542',
        bodyColor: '#FFFFFF',
        borderColor: '#D4AF37',
        borderWidth: 1,
        padding: 10,
        boxPadding: 4,
      }
    },
    scales: {
      x: {
        grid: { color: gridColor },
        ticks: { color: textColor, font: { family: 'Inter', size: 11 } }
      },
      y: {
        grid: { color: gridColor },
        ticks: { color: textColor, font: { family: 'Inter', size: 11 } }
      }
    }
  };

  const doughnutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: textColor,
          font: { family: 'Inter', size: 11 },
          boxWidth: 12
        }
      }
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Banner Alert: Mandatory DEMO Notice */}
      <div className="p-4 sm:p-5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 flex-shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="text-xs leading-relaxed">
            <strong className="block font-bold">
              {t.dashboard.demoWarning}
            </strong>
            <span className="text-slate-600 dark:text-amber-300/80">
              {t.dashboard.securityNotice}
            </span>
          </div>
        </div>

        {/* Demo Login / Session Toggle */}
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setIsAuthenticated(!isAuthenticated)}
            className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition ${
              isAuthenticated
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                : 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30'
            }`}
          >
            {isAuthenticated ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            <span>{isAuthenticated ? 'Demo Session: Active' : 'Demo Session: Locked'}</span>
          </button>
        </div>
      </div>

      {!isAuthenticated ? (
        <div className="max-w-md mx-auto p-8 bg-white dark:bg-brand-navy-800 rounded-3xl shadow-xl border border-slate-200 dark:border-brand-navy-700 text-center space-y-4">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-brand-gold-500/10 text-brand-gold-500 flex items-center justify-center">
            <Lock className="w-6 h-6" />
          </div>
          <h3 className="font-bold text-lg text-slate-900 dark:text-white">
            Demonstration Admin Login
          </h3>
          <p className="text-xs text-slate-500 leading-relaxed">
            This screen illustrates the administrative boundary. In Step 1, click below to unlock the demonstration dashboard state.
          </p>
          <button
            type="button"
            onClick={() => setIsAuthenticated(true)}
            className="w-full py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider bg-gradient-to-r from-brand-gold-500 to-amber-500 text-brand-navy-900 shadow-md"
          >
            Simulate Admin Sign-In
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Responsive Sidebar */}
          <aside className="lg:col-span-3 bg-white dark:bg-brand-navy-800/90 rounded-3xl border border-slate-200 dark:border-brand-navy-700 p-4 shadow-xl">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200 dark:border-brand-navy-700/80">
              <span className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
                Dashboard Nav
              </span>
              <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold bg-brand-gold-500/10 text-brand-gold-500 border border-brand-gold-500/20">
                DEMO DATA
              </span>
            </div>

            <nav className="space-y-1 text-xs font-semibold">
              <button
                onClick={() => setActiveTab('overview')}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition ${
                  activeTab === 'overview'
                    ? 'bg-brand-gold-500/15 text-brand-gold-600 dark:text-brand-gold-400 font-bold border border-brand-gold-500/30'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-brand-navy-700'
                }`}
              >
                <BarChart3 className="w-4 h-4" />
                <span>Executive Analytics</span>
              </button>

              <button
                onClick={() => setActiveTab('orders')}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition ${
                  activeTab === 'orders'
                    ? 'bg-brand-gold-500/15 text-brand-gold-600 dark:text-brand-gold-400 font-bold border border-brand-gold-500/30'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-brand-navy-700'
                }`}
              >
                <ShoppingCart className="w-4 h-4" />
                <span>Recent Orders Table</span>
              </button>

              <button
                onClick={() => setActiveTab('courses')}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition ${
                  activeTab === 'courses'
                    ? 'bg-brand-gold-500/15 text-brand-gold-600 dark:text-brand-gold-400 font-bold border border-brand-gold-500/30'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-brand-navy-700'
                }`}
              >
                <PieChart className="w-4 h-4" />
                <span>Course Enrollments</span>
              </button>

              <button
                onClick={() => setActiveTab('tools')}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition ${
                  activeTab === 'tools'
                    ? 'bg-brand-gold-500/15 text-brand-gold-600 dark:text-brand-gold-400 font-bold border border-brand-gold-500/30'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-brand-navy-700'
                }`}
              >
                <Activity className="w-4 h-4" />
                <span>Tool Usage Telemetry</span>
              </button>
            </nav>

            <div className="mt-6 pt-4 border-t border-slate-200 dark:border-brand-navy-700/80 text-[11px] text-slate-400 space-y-2">
              <div className="flex items-center gap-1.5 text-slate-500">
                <Database className="w-3.5 h-3.5" />
                <span>Backend: Offline Mock</span>
              </div>
              <p className="leading-tight text-[10px]">
                Persistent databases will be connected in Step 2+.
              </p>
            </div>
          </aside>

          {/* Main Dashboard Workspace */}
          <main className="lg:col-span-9 space-y-6">
            {/* Stat Cards 4-pack */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Earnings */}
              <div className="p-5 rounded-3xl bg-white dark:bg-brand-navy-800/90 border border-slate-200 dark:border-brand-navy-700 shadow-xl relative overflow-hidden">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
                  <span>{t.dashboard.totalEarnings}</span>
                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-brand-gold-500/10 text-brand-gold-500">Demo</span>
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white font-mono">
                  {dashboardData.summary.totalEarningsPKR}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-mono">
                  ≈ {dashboardData.summary.totalEarningsUSD} USD
                </div>
              </div>

              {/* Users */}
              <div className="p-5 rounded-3xl bg-white dark:bg-brand-navy-800/90 border border-slate-200 dark:border-brand-navy-700 shadow-xl">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
                  <span>{t.dashboard.totalUsers}</span>
                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500">Demo</span>
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white font-mono">
                  {dashboardData.summary.totalLearners.toLocaleString()}
                </div>
                <div className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-bold">
                  {dashboardData.summary.growthRate} this month
                </div>
              </div>

              {/* Orders */}
              <div className="p-5 rounded-3xl bg-white dark:bg-brand-navy-800/90 border border-slate-200 dark:border-brand-navy-700 shadow-xl">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
                  <span>{t.dashboard.totalOrders}</span>
                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500">Demo</span>
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white font-mono">
                  {dashboardData.summary.totalOrders}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Enrolled Course Orders
                </div>
              </div>

              {/* Tool Executions */}
              <div className="p-5 rounded-3xl bg-white dark:bg-brand-navy-800/90 border border-slate-200 dark:border-brand-navy-700 shadow-xl">
                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-2">
                  <span>Tool Operations</span>
                  <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500">Demo</span>
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white font-mono">
                  {dashboardData.summary.toolExecutions.toLocaleString()}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  100% Client Browser Runs
                </div>
              </div>
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Main Line Chart */}
              <div className="lg:col-span-8 p-6 bg-white dark:bg-brand-navy-800/90 rounded-3xl border border-slate-200 dark:border-brand-navy-700 shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                      Platform Growth & Activity Trends
                    </h3>
                    <p className="text-xs text-slate-400">Monthly enrollments vs tool runs (Chart.js Demo)</p>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-brand-navy-900 text-slate-500">
                    react-chartjs-2
                  </span>
                </div>
                <div className="h-64 sm:h-72 w-full">
                  <Line data={dashboardData.monthlyOrders} options={lineChartOptions} />
                </div>
              </div>

              {/* Doughnut Chart */}
              <div className="lg:col-span-4 p-6 bg-white dark:bg-brand-navy-800/90 rounded-3xl border border-slate-200 dark:border-brand-navy-700 shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                      {t.dashboard.courseOverview}
                    </h3>
                    <p className="text-xs text-slate-400">Enrollment share %</p>
                  </div>
                </div>
                <div className="h-64 sm:h-72 w-full flex items-center justify-center">
                  <Doughnut data={dashboardData.courseBreakdown} options={doughnutOptions} />
                </div>
              </div>
            </div>

            {/* Recent Orders Table */}
            <div className="p-6 bg-white dark:bg-brand-navy-800/90 rounded-3xl border border-slate-200 dark:border-brand-navy-700 shadow-xl space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                    {t.dashboard.recentOrders}
                  </h3>
                  <p className="text-xs text-slate-400">Mock transactions log with simulated payment channels</p>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                  DEMO DATA ONLY
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-brand-navy-700 text-slate-400 uppercase">
                      <th className="py-2.5 px-3 font-semibold">Order ID</th>
                      <th className="py-2.5 px-3 font-semibold">Simulated Learner</th>
                      <th className="py-2.5 px-3 font-semibold">Course Name</th>
                      <th className="py-2.5 px-3 font-semibold">Amount</th>
                      <th className="py-2.5 px-3 font-semibold">Payment Channel</th>
                      <th className="py-2.5 px-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-brand-navy-700/60 font-mono">
                    {dashboardData.recentOrders.map((ord) => (
                      <tr key={ord.id} className="hover:bg-slate-50 dark:hover:bg-brand-navy-700/40">
                        <td className="py-3 px-3 font-bold text-brand-gold-500">{ord.id}</td>
                        <td className="py-3 px-3 font-sans text-slate-700 dark:text-slate-300">{ord.customer}</td>
                        <td className="py-3 px-3 font-sans text-slate-900 dark:text-white">{ord.course}</td>
                        <td className="py-3 px-3 text-slate-800 dark:text-slate-200">{ord.amount}</td>
                        <td className="py-3 px-3 font-sans text-slate-500">{ord.channel}</td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                            {ord.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Tool Usage Breakdown */}
            <div className="p-6 bg-white dark:bg-brand-navy-800/90 rounded-3xl border border-slate-200 dark:border-brand-navy-700 shadow-xl space-y-4">
              <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                {t.dashboard.toolUsage}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {dashboardData.toolUsageMetrics.map((tool, idx) => (
                  <div key={idx} className="p-3.5 rounded-2xl bg-slate-50 dark:bg-brand-navy-900/60 border border-slate-200 dark:border-brand-navy-700/60 space-y-1.5 text-xs">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">{tool.name}</span>
                      <span className="font-mono text-brand-gold-500 font-bold">{tool.runs}</span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-brand-navy-700 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-brand-gold-500 to-amber-500 rounded-full"
                        style={{ width: `${tool.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </main>
        </div>
      )}
    </div>
  );
}

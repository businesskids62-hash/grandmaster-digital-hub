export const dashboardData = {
  isDemoData: true,
  summary: {
    totalEarningsPKR: "₨ 1,842,500",
    totalEarningsUSD: "$6,580",
    totalLearners: 1420,
    totalOrders: 384,
    toolExecutions: 19850,
    growthRate: "+24.8%"
  },
  monthlyOrders: {
    labels: ["May", "Jun", "Jul", "Aug", "Sep", "Oct"],
    datasets: [
      {
        label: "Course Enrollments (Demo)",
        data: [28, 45, 62, 78, 95, 120],
        borderColor: "#D4AF37",
        backgroundColor: "rgba(212, 175, 55, 0.2)",
        tension: 0.4,
        fill: true,
      },
      {
        label: "Tool Utility Runs (x100)",
        data: [65, 88, 110, 145, 180, 220],
        borderColor: "#3B82F6",
        backgroundColor: "rgba(59, 130, 246, 0.1)",
        tension: 0.4,
        fill: true,
      }
    ]
  },
  courseBreakdown: {
    labels: [
      "Scratch Games",
      "Python for Kids",
      "AI & ML",
      "Roblox Studio",
      "YouTube Creator",
      "Business Kids"
    ],
    datasets: [
      {
        data: [35, 28, 16, 12, 6, 3],
        backgroundColor: [
          "#10B981",
          "#3B82F6",
          "#8B5CF6",
          "#F59E0B",
          "#EF4444",
          "#D4AF37"
        ],
        borderWidth: 0
      }
    ]
  },
  recentOrders: [
    {
      id: "ORD-9401",
      customer: "Sample Learner A.",
      course: "Scratch Game Programming",
      amount: "₨ 12,500 ($45)",
      date: "2026-10-15",
      status: "Demo Simulated",
      channel: "Card Preview"
    },
    {
      id: "ORD-9402",
      customer: "Sample Learner B.",
      course: "Python for Young Masters",
      amount: "₨ 18,000 ($65)",
      date: "2026-10-14",
      status: "Demo Simulated",
      channel: "Bank Transfer Preview"
    },
    {
      id: "ORD-9403",
      customer: "Sample Learner C.",
      course: "Roblox Studio & Lua",
      amount: "₨ 19,500 ($70)",
      date: "2026-10-14",
      status: "Demo Simulated",
      channel: "JazzCash Preview"
    },
    {
      id: "ORD-9404",
      customer: "Sample Learner D.",
      course: "YouTube Creator Masterclass",
      amount: "₨ 14,000 ($50)",
      date: "2026-10-12",
      status: "Demo Simulated",
      channel: "Easypaisa Preview"
    },
    {
      id: "ORD-9405",
      customer: "Sample Learner E.",
      course: "AI & Machine Learning",
      amount: "₨ 22,000 ($80)",
      date: "2026-10-10",
      status: "Demo Simulated",
      channel: "Card Preview"
    }
  ],
  toolUsageMetrics: [
    { name: "Dynamic QR Code Generator", runs: "5,410 runs", percentage: 88, status: "Active" },
    { name: "Professional Invoice Maker", runs: "4,220 runs", percentage: 76, status: "Active" },
    { name: "Client-Side Image Compressor", runs: "3,890 runs", percentage: 65, status: "Active" },
    { name: "Cryptographic Password Generator", runs: "2,640 runs", percentage: 54, status: "Active" },
    { name: "Standard & Scientific Calculator", runs: "1,980 runs", percentage: 42, status: "Active" },
    { name: "Exact Age Calculator", runs: "1,710 runs", percentage: 38, status: "Active" }
  ]
};

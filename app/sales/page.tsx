import { getDashboardData } from "@/lib/data";
import { money, count, shortMonth } from "@/lib/format";
import LineChart from "@/components/LineChart";
import BarList from "@/components/BarList";
import Card from "@/components/Card";
import ModeBanner from "@/components/ModeBanner";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function SalesPage() {
  const data = await getDashboardData();
  const total = data.salesTrend.reduce((s, p) => s + p.revenue, 0);
  const orders = data.salesTrend.reduce((s, p) => s + p.orders, 0);
  const aov = orders ? total / orders : 0;

  return (
    <>
      <PageHeader title="Sales" subtitle="Revenue performance and order trends." />
      <ModeBanner mode={data.mode} note={data.note} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <div className="card p-4">
          <div className="text-xs text-[var(--muted)]">Revenue (12 mo)</div>
          <div className="mt-1 text-2xl font-semibold">{money(total)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-[var(--muted)]">Orders (12 mo)</div>
          <div className="mt-1 text-2xl font-semibold">{count(orders)}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-[var(--muted)]">Avg order value</div>
          <div className="mt-1 text-2xl font-semibold">{money(aov)}</div>
        </div>
      </div>

      <Card title="Revenue — last 12 months" className="mt-4">
        <LineChart data={data.salesTrend} />
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="By category">
          <BarList
            items={data.byCategory.map((c) => ({
              label: c.category,
              value: c.revenue,
              sub: `${count(c.units)} units`,
            }))}
          />
        </Card>
        <Card title="Monthly breakdown">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--muted)]">
                  <th className="pb-2 font-medium">Month</th>
                  <th className="pb-2 font-medium text-right">Revenue</th>
                  <th className="pb-2 font-medium text-right">Orders</th>
                  <th className="pb-2 font-medium text-right">AOV</th>
                </tr>
              </thead>
              <tbody>
                {[...data.salesTrend].reverse().map((m) => (
                  <tr key={m.period} className="border-t border-[var(--border)]">
                    <td className="py-2">
                      {shortMonth(m.period)} {m.period.split("-")[0]}
                    </td>
                    <td className="py-2 text-right tabular-nums">{money(m.revenue)}</td>
                    <td className="py-2 text-right tabular-nums">{count(m.orders)}</td>
                    <td className="py-2 text-right tabular-nums text-[var(--muted)]">
                      {money(m.orders ? m.revenue / m.orders : 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

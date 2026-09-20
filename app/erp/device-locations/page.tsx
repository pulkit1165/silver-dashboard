import PageHeader from "@/components/PageHeader";
import { getCurrentUser } from "@/lib/erp/session";
import { canWrite } from "@/lib/erp/rbac";
import { listLatestDeviceLocations, listDeviceLocations } from "@/lib/erp/deviceLocations";
import DeviceLocationsPanel from "@/components/erp/DeviceLocationsPanel";

export const dynamic = "force-dynamic";

export default async function DeviceLocationsPage() {
  const user = await getCurrentUser();
  if (!canWrite(user, "device_locations")) {
    return (
      <>
        <PageHeader title="Device Locations" subtitle="Where company-issued phones/tablets were last seen." />
        <section className="panel p-4 text-sm text-[var(--muted)]">Your role ({user.role}) doesn't have access to device locations.</section>
      </>
    );
  }
  const [latest, recent] = await Promise.all([listLatestDeviceLocations(), listDeviceLocations(500)]);
  return (
    <>
      <PageHeader
        title="Device Locations"
        subtitle="Best-effort browser geolocation from company-issued devices — captured on login, on every scan, and every few minutes while the app is open. Requires the device to have granted location permission."
      />
      <DeviceLocationsPanel initialLatest={latest} initialRecent={recent} />
    </>
  );
}

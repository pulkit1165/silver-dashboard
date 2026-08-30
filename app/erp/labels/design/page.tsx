import PageHeader from "@/components/PageHeader";
import LabelDesigner from "@/components/erp/LabelDesigner";

export const dynamic = "force-dynamic";

export default function LabelDesignPage() {
  return (
    <>
      <PageHeader
        title="Label Designer"
        subtitle="Design each label at its real size — drag, resize, choose fonts. Save a draft, test-print, then Approve to go live. The current design keeps printing until you approve a new one."
      />
      <LabelDesigner />
    </>
  );
}

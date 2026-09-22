import { DocumentDetail } from "@/features/documents/document-detail";

export default function Page({ params }: { params: { id: string } }) {
  return <DocumentDetail kind="sale" id={params.id} />;
}

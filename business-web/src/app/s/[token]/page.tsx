import { SharedPage } from "@/features/share/shared-page";

export default function Page({ params }: { params: { token: string } }) {
  return <SharedPage token={params.token} />;
}

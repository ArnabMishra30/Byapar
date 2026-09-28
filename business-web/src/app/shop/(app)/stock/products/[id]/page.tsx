import { ProductDetail } from "@/features/products/product-detail";

export default function Page({ params }: { params: { id: string } }) {
  return <ProductDetail id={params.id} />;
}

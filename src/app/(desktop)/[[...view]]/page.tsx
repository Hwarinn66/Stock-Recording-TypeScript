import { notFound, redirect } from "next/navigation";
import {
  Dashboard,
  ProductsPage,
  ProductForm,
  ProductDetail,
  HistoryHub,
  LocationManager,
  AdjustmentsPage,
  SettingsPage,
} from "@/components/workspace";
export default async function Page({
  params,
}: {
  params: Promise<{ view?: string[] }>;
}) {
  const path = (await params).view || [];
  const key = path.join("/");
  if (!key) return <Dashboard />;
  // Halaman kecil yang sudah digabung: alamat lama tetap berfungsi.
  if (key === "pending") redirect("/");
  if (key === "categories") redirect("/settings");
  if (key === "history") redirect("/history/in");
  if (key === "products") return <ProductsPage />;
  if (key === "low-stock") return <ProductsPage low />;
  if (key === "products/new") return <ProductForm />;
  if (path[0] === "products" && /^\d+$/.test(path[1] || "")) {
    if (path[2] === "edit") return <ProductForm id={Number(path[1])} />;
    if (path.length === 2 || path[2] === "qr")
      return <ProductDetail id={Number(path[1])} qrOnly={path[2] === "qr"} />;
  }
  if (key === "history/in") return <HistoryHub type="in" />;
  if (key === "history/out") return <HistoryHub type="out" />;
  if (key === "history/adjustments") return <HistoryHub type="adjustments" />;
  if (key === "reservations") return <HistoryHub type="reservations" />;
  if (key === "locations") return <LocationManager />;
  if (key === "adjustments") return <AdjustmentsPage />;
  if (path[0] === "adjustments" && /^\d+$/.test(path[1] || "") && path.length === 2)
    return <AdjustmentsPage key={path[1]} productId={Number(path[1])} />;
  if (key === "settings") return <SettingsPage />;
  notFound();
}

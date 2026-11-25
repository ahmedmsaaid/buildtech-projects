/** The products this platform sells, for the owner dashboard to list and to build its "new customer" form. */
import type { APIRoute } from 'astro';
import { isFromDashboard, json, notFound } from '../../lib/internal';
import { productList } from '../../lib/products';

export const GET: APIRoute = ({ request }) => {
  if (!isFromDashboard(request)) return notFound();
  return json(
    productList.map(({ key, customer, customers, icon, dashboardPath, publicPage, setupFields }) => ({
      key,
      customer,
      customers,
      icon,
      dashboardPath,
      publicPage,
      setupFields,
    })),
  );
};

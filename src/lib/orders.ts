/** Orders: placing one, the kitchen's view of the day, moving an order along, and reports. */
import { isUniqueViolation, newId } from './db';
import { queryFor } from './tenants';
import { getMenu, type Restaurant } from './restaurants';
import { nowIn } from './time';

export const orderStatuses = ['new', 'preparing', 'ready', 'done', 'cancelled'] as const;
export type OrderStatus = (typeof orderStatuses)[number];

export const orderStatusLabels: Record<OrderStatus, string> = {
  new: 'جديد',
  preparing: 'بيتحضّر',
  ready: 'جاهز',
  done: 'اتسلّم',
  cancelled: 'ملغي',
};

/** Where an order goes next, in the kitchen's normal flow. */
export const nextStatus: Partial<Record<OrderStatus, OrderStatus>> = { new: 'preparing', preparing: 'ready', ready: 'done' };

export interface OrderLine {
  name: string;
  price: number;
  quantity: number;
}

export interface Order {
  id: string;
  number: number;
  day: string;
  type: 'dine_in' | 'pickup';
  table_number: number | null;
  customer_name: string;
  customer_phone: string;
  note: string;
  status: OrderStatus;
  total: number;
  created_at: string | Date;
  lines: OrderLine[];
}

/** Limits that keep a single order sane, and a prank order small. */
const MAX_LINES = 30;
const MAX_QUANTITY = 20;

export interface OrderRequest {
  /** Present when the guest scanned a table's QR code; absent for a collection order. */
  tableNumber: number | null;
  customerName: string;
  customerPhone: string;
  note: string;
  /** Item id to quantity, as the guest's phone sent it. Never trusted for names or prices. */
  quantities: Map<string, number>;
}

export type OrderResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'closed' | 'empty' | 'unavailable' | 'bad_table' | 'pickup_off' | 'contact_needed' | 'too_big' };

/**
 * Places an order. Names and prices are taken from the menu as it is now,
 * never from the request, and an item that sold out in the meantime stops
 * the order rather than being dropped silently.
 */
export async function placeOrder(restaurant: Restaurant, request: OrderRequest): Promise<OrderResult> {
  if (!restaurant.accepts_orders) return { ok: false, reason: 'closed' };

  const wanted = [...request.quantities].filter(([, quantity]) => quantity > 0);
  if (wanted.length === 0) return { ok: false, reason: 'empty' };
  if (wanted.length > MAX_LINES || wanted.some(([, quantity]) => !Number.isInteger(quantity) || quantity > MAX_QUANTITY)) {
    return { ok: false, reason: 'too_big' };
  }

  const isDineIn = request.tableNumber !== null;
  if (isDineIn && (request.tableNumber! < 1 || request.tableNumber! > restaurant.tables_count)) return { ok: false, reason: 'bad_table' };
  if (!isDineIn && !restaurant.allows_pickup) return { ok: false, reason: 'pickup_off' };
  // Nobody is at a table to hand a collection order to, so the kitchen needs a name and a number.
  if (!isDineIn && (request.customerName.length < 2 || !request.customerPhone)) return { ok: false, reason: 'contact_needed' };

  const onSale = new Map((await getMenu(restaurant.id)).flatMap((category) => category.items).filter((item) => item.is_available).map((item) => [item.id, item]));
  const lines = wanted.map(([itemId, quantity]) => ({ item: onSale.get(itemId), quantity }));
  if (lines.some((line) => !line.item)) return { ok: false, reason: 'unavailable' };

  const total = lines.reduce((sum, line) => sum + line.item!.price * line.quantity, 0);
  const day = nowIn(restaurant.timezone).day;
  const id = newId();

  // The day's next number. Two orders at the same moment can pick the same
  // one; the unique index refuses the second, which then simply tries again.
  for (let attempt = 0; ; attempt++) {
    try {
      await queryFor(restaurant.id, 
        `insert into orders (id, restaurant_id, number, day, type, table_number, customer_name, customer_phone, note, total)
         values ($1, $2, (select coalesce(max(number), 0) + 1 from orders where restaurant_id = $2 and day = $3), $3, $4, $5, $6, $7, $8, $9)`,
        [id, restaurant.id, day, isDineIn ? 'dine_in' : 'pickup', request.tableNumber, request.customerName, request.customerPhone, request.note, total],
      );
      break;
    } catch (error) {
      if (!isUniqueViolation(error) || attempt >= 4) throw error;
    }
  }

  for (const line of lines) {
    await queryFor(restaurant.id, 'insert into order_items (id, order_id, item_id, name, price, quantity) values ($1, $2, $3, $4, $5, $6)', [
      newId(),
      id,
      line.item!.id,
      line.item!.name,
      line.item!.price,
      line.quantity,
    ]);
  }
  return { ok: true, id };
}

const ORDER_COLUMNS = 'id, number, day, type, table_number, customer_name, customer_phone, note, status, total, created_at';

async function withLines(restaurantId: string, orders: Omit<Order, 'lines'>[]): Promise<Order[]> {
  if (orders.length === 0) return [];
  const placeholders = orders.map((_, index) => `$${index + 1}`).join(', ');
  const lines = await queryFor<OrderLine & { order_id: string }>(restaurantId, 
    `select order_id, name, price, quantity from order_items where order_id in (${placeholders}) order by name`,
    orders.map((order) => order.id),
  );
  return orders.map((order) => ({ ...order, lines: lines.filter((line) => line.order_id === order.id) }));
}

export async function getOrder(restaurantId: string, id: string): Promise<Order | null> {
  const orders = await queryFor<Omit<Order, 'lines'>>(restaurantId, `select ${ORDER_COLUMNS} from orders where restaurant_id = $1 and id = $2`, [restaurantId, id]);
  return (await withLines(restaurantId, orders))[0] ?? null;
}

/** Every order of a day, oldest first, each with its lines. */
export async function getOrdersOn(restaurantId: string, day: string): Promise<Order[]> {
  const orders = await queryFor<Omit<Order, 'lines'>>(restaurantId, `select ${ORDER_COLUMNS} from orders where restaurant_id = $1 and day = $2 order by created_at`, [
    restaurantId,
    day,
  ]);
  return withLines(restaurantId, orders);
}

export async function setOrderStatus(restaurantId: string, id: string, status: OrderStatus): Promise<void> {
  await queryFor(restaurantId, 'update orders set status = $3 where restaurant_id = $1 and id = $2', [restaurantId, id, status]);
}

export interface OrderReport {
  totals: { orders: number; revenue: number; cancelled: number; dine_in: number };
  perDay: { day: string; orders: number }[];
  topItems: { name: string; quantity: number; revenue: number }[];
}

/** Figures for a range of days. Cancelled orders count only as cancellations. */
export async function getOrderReport(restaurantId: string, fromDay: string, toDay: string): Promise<OrderReport> {
  const range = [restaurantId, fromDay, toDay];
  const inRange = 'restaurant_id = $1 and day between $2 and $3';

  const [[totals], perDay, topItems] = await Promise.all([
    queryFor<OrderReport['totals']>(restaurantId, 
      `select
         count(*) filter (where status <> 'cancelled')::int as orders,
         coalesce(sum(total) filter (where status <> 'cancelled'), 0)::int as revenue,
         count(*) filter (where status = 'cancelled')::int as cancelled,
         count(*) filter (where status <> 'cancelled' and type = 'dine_in')::int as dine_in
       from orders where ${inRange}`,
      range,
    ),
    queryFor<OrderReport['perDay'][number]>(restaurantId, 
      `select day, count(*) filter (where status <> 'cancelled')::int as orders from orders where ${inRange} group by day order by day`,
      range,
    ),
    queryFor<OrderReport['topItems'][number]>(restaurantId, 
      `select order_items.name, sum(order_items.quantity)::int as quantity, sum(order_items.quantity * order_items.price)::int as revenue
       from order_items join orders on orders.id = order_items.order_id
       where orders.restaurant_id = $1 and orders.day between $2 and $3 and orders.status <> 'cancelled'
       group by order_items.name order by quantity desc limit 8`,
      range,
    ),
  ]);

  return { totals, perDay, topItems };
}

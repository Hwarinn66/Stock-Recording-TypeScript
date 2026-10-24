import { mutateLocation, listLocations } from "../../src/services/locations";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { db, rows, execute } from "../../src/lib/db";
import {
  createProduct,
  editProduct,
  regenerate,
} from "../../src/services/products";
import {
  scan,
  approve,
  cancel,
  adjustment,
  lookup,
  record,
  revise,
} from "../../src/services/transactions";
import { history } from "../../src/services/reports";
import { importProducts, readProductRows } from "../../src/services/product-import";
import { listSchema } from "../../src/validators";
// Only run on a disposable database whose name ends in _test. Import schema first.
if (!process.env.DB_NAME?.endsWith("_test"))
  throw new Error("Integration tests require DB_NAME ending in _test");
let user: number;
let category: number;
let location: number;
let product: number;
let token: string;
let room: number;
let block: number;
let rack: number;
before(async () => {
  await execute("DELETE FROM stock_events");
  await execute("DELETE FROM stock_transactions");
  await execute("DELETE FROM products");
  await execute("DELETE FROM locations");
  await execute("DELETE FROM racks");
  await execute("DELETE FROM blocks");
  await execute("DELETE FROM rooms");
  await execute("DELETE FROM categories");
  await execute("DELETE FROM sessions");
  await execute("DELETE FROM users");
  category = (await execute("INSERT INTO categories(name) VALUES ('Testing')"))
    .insertId;
  room = (
    await mutateLocation("rooms", "POST", undefined, { name: "Ruangan Test" })
  ).id!;
  block = (
    await mutateLocation("blocks", "POST", undefined, {
      room_id: room,
      code: "T",
      name: "Blok Test",
    })
  ).id!;
  rack = (
    await mutateLocation("racks", "POST", undefined, {
      block_id: block,
      rack_number: 1,
      name: "Rak 01",
    })
  ).id!;
  location = (
    await mutateLocation("locations", "POST", undefined, {
      rack_id: rack,
      position_number: 1,
      name: "Posisi 01",
    })
  ).id!;
  user = (
    await execute(
      "INSERT INTO users(username,password_hash) VALUES ('test','disabled')",
    )
  ).insertId;
});
after(async () => {
  await db.query("DROP TRIGGER IF EXISTS test_force_failure");
  await db.end();
});
async function p() {
  return (
    await rows<{ stock: number; qr_token: string; location_id: number }>(
      "SELECT * FROM products WHERE id=?",
      [product],
    )
  )[0];
}
test("end-to-end SQL inventory and concurrency", async (t) => {
  await t.test("1 create product, stock zero, auto QR", async () => {
    product = (
      await createProduct({
        sku: "BRG-001",
        name: "Mouse Logitech",
        unit: "PCS",
        category_id: category,
        location_id: location,
      })
    ).id;
    const item = await p();
    assert.equal(item.stock, 0);
    assert.match(item.qr_token, /^[0-9a-f-]{36}$/);
    token = item.qr_token;
  });
  await t.test(
    "multiple products in one rack, independent numbering per rack",
    async () => {
      const other = (
        await createProduct({
          sku: "SLOT-2",
          name: "Keyboard",
          unit: "PCS",
          category_id: category,
          rack_id: rack,
          position_number: 2,
        })
      ).id;
      const available = await listLocations("locations");
      const slot2 = available.find(
        (l) => l.rack_id === rack && l.position_number === 2,
      )!.id;
      assert.equal(available.find((l) => l.id === location)?.code, "T.01.01");
      assert.equal(available.find((l) => l.id === slot2)?.code, "T.01.02");
      await assert.rejects(
        mutateLocation("locations", "POST", undefined, {
          rack_id: rack,
          position_number: 2,
          name: "Duplicate",
        }),
        { code: "ER_DUP_ENTRY" },
      );
      await assert.rejects(
        mutateLocation("blocks", "PATCH", block, {
          room_id: room,
          code: "CHANGED",
          name: "Block",
        }),
        { code: "IN_USE" },
      );
      const qr = (
        await rows<{ qr_token: string }>(
          "SELECT qr_token FROM products WHERE id=?",
          [other],
        )
      )[0].qr_token;
      const scans = await Promise.all([
        scan(token, "IN", user),
        scan(qr, "IN", user),
      ]);
      assert.equal(scans.length, 2);
      await Promise.all(scans.map((s) => cancel(s.id)));
      await assert.rejects(
        mutateLocation("locations", "PATCH", location, {
          rack_id: rack,
          position_number: 3,
          name: "Moved",
        }),
        { code: "IN_USE" },
      );
    },
  );
  await t.test("same block/rack/position code may repeat in another room", async () => {
    const room2 = (
      await mutateLocation("rooms", "POST", undefined, { name: "Ruangan Test 2" })
    ).id!;
    const block2 = (
      await mutateLocation("blocks", "POST", undefined, {
        room_id: room2,
        code: "T",
        name: "Blok Test",
      })
    ).id!;
    const rack2 = (
      await mutateLocation("racks", "POST", undefined, {
        block_id: block2,
        rack_number: 1,
        name: "Rak 01",
      })
    ).id!;
    const location2 = (
      await mutateLocation("locations", "POST", undefined, {
        rack_id: rack2,
        position_number: 1,
        name: "Posisi 01",
      })
    ).id!;
    const locations = await listLocations("locations");
    const first = locations.find((l) => l.id === location)!;
    const second = locations.find((l) => l.id === location2)!;
    assert.equal(first.code, "T.01.01");
    assert.equal(second.code, "T.01.01");
    assert.notEqual(first.room_id, second.room_id);
  });

  await t.test("7 OUT zero rejected, no pending created", async () => {
    await assert.rejects(scan(token, "OUT", user), { code: "STOCK_EMPTY" });
    assert.equal(
      (await rows("SELECT id FROM stock_transactions WHERE status='PENDING'"))
        .length,
      0,
    );
  });
  await t.test("2 IN scan does not change stock, approve +10", async () => {
    const s = await scan(token, "IN", user);
    assert.equal((await p()).stock, 0);
    const [pending] = await rows<{ quantity: number | null; status: string }>(
      "SELECT * FROM stock_transactions WHERE id=?",
      [s.id],
    );
    assert.equal(pending.quantity, null);
    assert.equal(pending.status, "PENDING");
    await approve(s.id, 10, user);
    assert.equal((await p()).stock, 10);
  });
  await t.test("3 OUT -5", async () => {
    const s = await scan(token, "OUT", user);
    await approve(s.id, 5, user);
    assert.equal((await p()).stock, 5);
  });
  await t.test(
    "4 concurrent double scan accepts exactly one across modes",
    async () => {
      const results = await Promise.allSettled([
        scan(token, "IN", user),
        scan(token, "OUT", user),
        scan(token, "IN", user),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const [pending] = await rows<{ id: number }>(
        "SELECT id FROM stock_transactions WHERE status='PENDING'",
      );
      await assert.rejects(regenerate(product), { code: "PRODUCT_PENDING" });
      await assert.rejects(editProduct(product, { active: false }), {
        code: "PRODUCT_PENDING",
      });
      await cancel(pending.id);
    },
  );
  await t.test(
    "5 cancel preserves stock and unlocks QR; terminal states immutable",
    async () => {
      const s = await scan(token, "IN", user);
      await cancel(s.id);
      assert.equal((await p()).stock, 5);
      await assert.rejects(approve(s.id, 1, user), {
        code: "ALREADY_PROCESSED",
      });
      const again = await scan(token, "IN", user);
      await cancel(again.id);
    },
  );
  await t.test("6 excessive OUT rollback and 8 low stock", async () => {
    const s = await scan(token, "OUT", user);
    await assert.rejects(approve(s.id, 10, user), { code: "STOCK_NOT_ENOUGH" });
    assert.equal((await p()).stock, 5);
    await approve(s.id, 3, user);
    assert.equal((await p()).stock, 2);
    await assert.rejects(approve(s.id, 3, user), { code: "ALREADY_PROCESSED" });
  });
  await t.test("10 duplicate occupied position rejected", async () => {
    await assert.rejects(
      createProduct({
        sku: "BRG-002",
        name: "Keyboard",
        unit: "PCS",
        category_id: category,
        rack_id: rack,
        position_number: 1,
      }),
      { code: "LOCATION_IN_USE" },
    );
  });
  await t.test(
    "11 injected SQL failure after stock update rolls back everything",
    async () => {
      const s = await scan(token, "IN", user);
      await db.query(
        "CREATE TRIGGER test_force_failure BEFORE INSERT ON stock_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='injected failure'",
      );
      try {
        await assert.rejects(approve(s.id, 7, user));
        assert.equal((await p()).stock, 2);
        const [tx] = await rows<{ status: string; quantity: number | null }>(
          "SELECT * FROM stock_transactions WHERE id=?",
          [s.id],
        );
        assert.equal(tx.status, "PENDING");
        assert.equal(tx.quantity, null);
      } finally {
        await db.query("DROP TRIGGER test_force_failure");
      }
      await cancel(s.id);
    },
  );
  await t.test("concurrent approvals update stock only once", async () => {
    const s = await scan(token, "IN", user);
    const r = await Promise.allSettled([
      approve(s.id, 8, user),
      approve(s.id, 8, user),
    ]);
    assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal((await p()).stock, 10);
  });
  await t.test("adjustment audit and stale stock protection", async () => {
    await adjustment(
      {
        product_id: product,
        expected_stock: 10,
        physical_stock: 8,
        notes: "2 barang rusak",
      },
      user,
    );
    assert.equal((await p()).stock, 8);
    await assert.rejects(
      adjustment(
        {
          product_id: product,
          expected_stock: 10,
          physical_stock: 5,
          notes: "stale",
        },
        user,
      ),
      { code: "STALE_STOCK" },
    );
  });
  await t.test(
    "rack move preserves old history and invalidates regenerated QR",
    async () => {
      const rack2 = (
        await mutateLocation("racks", "POST", undefined, {
          block_id: block,
          rack_number: 2,
          name: "Rak 02",
        })
      ).id!;
      const loc2 = (
        await mutateLocation("locations", "POST", undefined, {
          rack_id: rack2,
          position_number: 1,
          name: "Posisi 01",
        })
      ).id!;
      assert.equal(
        (await listLocations("locations")).find((l) => l.id === loc2)?.code,
        "T.02.01",
      );
      await editProduct(product, { location_id: loc2 });
      const [old] = await rows<{ location_id: number; location_code: string }>(
        "SELECT * FROM stock_transactions WHERE product_id=? ORDER BY id LIMIT 1",
        [product],
      );
      assert.equal(old.location_id, location);
      assert.equal(old.location_code, "T.01.01");
      await regenerate(product);
      await assert.rejects(scan(token, "IN", user), { code: "QR_NOT_FOUND" });
      token = (await p()).qr_token;
      await editProduct(product, { active: false });
      await assert.rejects(scan(token, "IN", user), {
        code: "PRODUCT_INACTIVE",
      });
    },
  );
});

test("mobile scanner: direct stock change with reservation number", async (t) => {
  await editProduct(product, { active: true });
  const transactions = async () =>
    (await rows("SELECT id FROM stock_transactions")).length;
  await t.test("lookup returns product without photo", async () => {
    const found = await lookup(token, "IN");
    assert.equal(found.id, product);
    assert.equal(found.stock, 8);
    assert.equal("image" in found, false);
  });
  await t.test("IN changes stock immediately, no reservation", async () => {
    const r = await record({ qr_token: token, mode: "IN", quantity: 5 }, user);
    assert.equal(r.stock_before, 8);
    assert.equal(r.stock_after, 13);
    assert.equal((await p()).stock, 13);
    const [tx] = await rows<{
      status: string;
      quantity: number;
      reservation_number: string | null;
      approved_at: string | null;
    }>("SELECT * FROM stock_transactions WHERE id=?", [r.id]);
    assert.equal(tx.status, "APPROVED");
    assert.equal(tx.quantity, 5);
    assert.equal(tx.reservation_number, null);
    assert.ok(tx.approved_at);
  });
  await t.test("OUT stores reservation with leading zeros", async () => {
    const r = await record(
      {
        qr_token: token,
        mode: "OUT",
        quantity: 3,
        reservation_number: "0012345",
      },
      user,
    );
    assert.equal((await p()).stock, 10);
    assert.equal(r.reservation_number, "0012345");
    const found = await history(
      "OUT",
      listSchema.parse({ q: "0012345" }),
      true,
    );
    assert.equal(found.total, 1);
    assert.equal(found.items[0].reservation_number, "0012345");
    assert.equal(found.items[0].actor_name, "test");
    // Riwayat reservasi hanya berisi OUT yang memiliki no reservasi.
    const all = await history("OUT", listSchema.parse({}), true);
    assert.ok(all.items.every((item) => item.reservation_number));
  });
  await t.test("OUT above stock rejected and nothing recorded", async () => {
    const before = await transactions();
    await assert.rejects(
      record(
        {
          qr_token: token,
          mode: "OUT",
          quantity: 999,
          reservation_number: "1234567",
        },
        user,
      ),
      { code: "STOCK_NOT_ENOUGH" },
    );
    assert.equal((await p()).stock, 10);
    assert.equal(await transactions(), before);
  });
  await t.test("concurrent OUT never drives stock negative", async () => {
    const results = await Promise.allSettled([
      record(
        { qr_token: token, mode: "OUT", quantity: 6, reservation_number: "1111111" },
        user,
      ),
      record(
        { qr_token: token, mode: "OUT", quantity: 6, reservation_number: "2222222" },
        user,
      ),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await p()).stock, 4);
  });
  await t.test("empty stock and legacy pending block the scanner", async () => {
    await adjustment(
      { product_id: product, expected_stock: 4, physical_stock: 0, notes: "opname" },
      user,
    );
    await assert.rejects(lookup(token, "OUT"), { code: "STOCK_EMPTY" });
    const pending = await scan(token, "IN", user);
    await assert.rejects(lookup(token, "IN"), { code: "PRODUCT_PENDING" });
    await assert.rejects(
      record({ qr_token: token, mode: "IN", quantity: 1 }, user),
      { code: "PRODUCT_PENDING" },
    );
    await cancel(pending.id);
    await editProduct(product, { active: false });
    await assert.rejects(lookup(token, "IN"), { code: "PRODUCT_INACTIVE" });
    await assert.rejects(
      record({ qr_token: token, mode: "IN", quantity: 1 }, user),
      { code: "PRODUCT_INACTIVE" },
    );
  });
});

test("CSV import: ERP location, movement label and exact Kg decimals", async (t) => {
  const csv = (lines: string[]) =>
    readProductRows(["lokasi2,nobar,nabar,satuan,stock_type,saldoakhir", ...lines].join("\n"), "Import Test").items;
  const count = async () => (await rows("SELECT id FROM products")).length;
  type Placed = {
    id: number;
    qr_token: string;
    name: string;
    unit: string;
    stock: number;
    movement_class: string | null;
    code: string;
    position_number: number;
    rack_number: number;
    block: string;
    room: string;
  };
  const placed = async (sku: string) =>
    (
      await rows<Placed>(
        "SELECT p.id,p.qr_token,p.name,p.unit,p.stock,p.movement_class,l.code,l.position_number,r.rack_number,b.code block,rm.name room FROM products p JOIN locations l ON l.id=p.location_id JOIN racks r ON r.id=l.rack_id JOIN blocks b ON b.id=r.block_id JOIN rooms rm ON rm.id=b.room_id WHERE p.sku=?",
        [sku],
      )
    )[0];
  const items = csv([
    `B.02.01.001,IMP-KG,"WIRE;ROPE;Ø5/8"";${"X".repeat(150)}",K g,DEAD STOCK,548.8`,
    "B.06.10.030,IMP-A,Filter A,Pcs,SLOW MOVING,2",
    "B.06.10.030,IMP-B,Filter B,Pcs,FAST MOVING,0",
    "POLE FACTORY,IMP-POLE,Concrete steel,Btg,SLOW MOVING,5",
    ",IMP-NOLOC,Tanpa lokasi,Pcs,,1",
    "A.01.01.002,SLOT-2,Keyboard,PCS,FAST MOVING,7",
  ]);
  await t.test("dry run reads only", async () => {
    const before = await count();
    const summary = await importProducts(items, false);
    assert.equal(summary.created, 5);
    assert.equal(summary.updated, 1);
    assert.equal(await count(), before);
  });
  await t.test("apply places items at ERP codes with labels and exact stock", async () => {
    const summary = await importProducts(items, true);
    assert.equal(summary.created, 5);
    assert.deepEqual(summary.sharedLocations, [{ sku: "IMP-B", code: "B.06.10.030 (2)" }]);
    const kg = await placed("IMP-KG");
    assert.equal(kg.stock, 548.8, "tanpa pembulatan");
    assert.equal(kg.unit, "Kg");
    assert.equal(kg.movement_class, "DEAD");
    assert.ok(kg.name.length > 160);
    assert.deepEqual([kg.room, kg.block, kg.rack_number, kg.position_number, kg.code], ["Ruangan 1", "B", 2, 1001, "B.02.01.001"]);
    const a = await placed("IMP-A");
    const b = await placed("IMP-B");
    assert.deepEqual([a.code, a.position_number, a.movement_class], ["B.06.10.030", 10030, "SLOW"]);
    assert.equal(b.code, "B.06.10.030 (2)");
    assert.ok(b.position_number >= 900000);
    const pole = await placed("IMP-POLE");
    assert.deepEqual([pole.room, pole.code], ["POLE FACTORY", "POLE FACTORY"]);
    assert.equal((await placed("IMP-NOLOC")).room, "Belum Ditempatkan");
    const slot = await placed("SLOT-2");
    assert.deepEqual([slot.stock, slot.movement_class, slot.room, slot.code], [7, "FAST", "Ruangan 1", "A.01.01.002"]);
    assert.equal(
      (await rows("SELECT id FROM stock_transactions WHERE product_id=?", [kg.id])).length,
      0,
      "impor tanpa histori",
    );
  });
  await t.test("re-import is idempotent; pending product is skipped", async () => {
    const before = await count();
    assert.equal((await importProducts(items, true)).unchanged, 6);
    assert.equal(await count(), before);
    const slot = await placed("SLOT-2");
    const pending = await scan(slot.qr_token, "IN", user);
    const summary = await importProducts(csv(["A.01.01.002,SLOT-2,Keyboard,PCS,FAST MOVING,99"]), true);
    assert.deepEqual(summary.skipped.map((s) => s.sku), ["SLOT-2"]);
    await cancel(pending.id);
  });
  await t.test("Kg transactions and adjustments keep decimals; Pcs stays whole", async () => {
    const kg = await placed("IMP-KG");
    const out = await record(
      { qr_token: kg.qr_token, mode: "OUT", quantity: 0.3, reservation_number: "7654321" },
      user,
    );
    assert.deepEqual([out.stock_before, out.stock_after], [548.8, 548.5]);
    const [tx] = await rows<{ quantity: number; stock_after: number }>(
      "SELECT quantity,stock_after FROM stock_transactions WHERE id=?",
      [out.id],
    );
    assert.deepEqual([tx.quantity, tx.stock_after], [0.3, 548.5]);
    await adjustment({ product_id: kg.id, expected_stock: 548.5, physical_stock: 548.25, notes: "timbang ulang" }, user);
    assert.equal((await placed("IMP-KG")).stock, 548.25);
    const slot = await placed("SLOT-2");
    await assert.rejects(record({ qr_token: slot.qr_token, mode: "IN", quantity: 1.5 }, user), {
      code: "INVALID_QUANTITY",
    });
    await assert.rejects(
      adjustment({ product_id: slot.id, expected_stock: 7, physical_stock: 6.5, notes: "salah" }, user),
      { code: "INVALID_QUANTITY" },
    );
  });
  await t.test("holding area is removed once empty", async () => {
    await importProducts(csv([`A.01.01.003,IMP-NOLOC,Tanpa lokasi,Pcs,,1`]), true);
    assert.equal((await placed("IMP-NOLOC")).code, "A.01.01.003");
    assert.equal((await rows("SELECT id FROM rooms WHERE name='Belum Ditempatkan'")).length, 0);
  });
});

test("history revision: fix quantity or reservation of a saved IN/OUT", async (t) => {
  const admin = { id: user, username: "test" };
  type Tx = { quantity: number; stock_after: number; reservation_number: string | null; notes: string | null };
  const tx = async (id: number) =>
    (await rows<Tx>("SELECT * FROM stock_transactions WHERE id=?", [id]))[0];
  await editProduct(product, { active: true });
  const current = (await p()).stock;
  await adjustment(
    { product_id: product, expected_stock: current, physical_stock: 10, notes: "awal tes revisi" },
    user,
  );
  const inbound = await record({ qr_token: token, mode: "IN", quantity: 5 }, user);
  const outbound = await record(
    { qr_token: token, mode: "OUT", quantity: 4, reservation_number: "1234567" },
    user,
  );
  assert.equal((await p()).stock, 11);
  await t.test("IN quantity 5 → 3 lowers stock by 2", async () => {
    const r = await revise(inbound.id, { quantity: 3, reason: "salah ketik" }, admin);
    assert.equal(r.stock, 9);
    assert.equal((await p()).stock, 9);
    const row = await tx(inbound.id);
    assert.equal(row.quantity, 3);
    assert.equal(row.stock_after, 13);
    assert.match(row.notes ?? "", /oleh test: jumlah 5 → 3 .* \(alasan: salah ketik\)/);
  });
  await t.test("OUT reservation fix leaves stock unchanged", async () => {
    await revise(outbound.id, { reservation_number: "7654321" }, admin);
    assert.equal((await p()).stock, 9);
    const row = await tx(outbound.id);
    assert.equal(row.reservation_number, "7654321");
    assert.match(row.notes ?? "", /no reservasi 1234567 → 7654321/);
  });
  await t.test("OUT quantity 4 → 2 returns 2 to stock", async () => {
    await revise(outbound.id, { quantity: 2 }, admin);
    assert.equal((await p()).stock, 11);
    // Stok sesudah transaksi ini dihitung ulang dari stok sebelumnya (15 - 2).
    assert.equal((await tx(outbound.id)).stock_after, 13);
  });
  await t.test("revision that would make stock negative is rejected", async () => {
    await assert.rejects(revise(outbound.id, { quantity: 50 }, admin), {
      code: "STOCK_NOT_ENOUGH",
    });
    assert.equal((await p()).stock, 11);
    assert.equal((await tx(outbound.id)).quantity, 2);
  });
  await t.test("invalid revisions are rejected", async () => {
    await assert.rejects(
      revise(inbound.id, { reservation_number: "1111111" }, admin),
      { code: "VALIDATION_ERROR" },
    );
    await assert.rejects(revise(inbound.id, { quantity: 3 }, admin), {
      code: "NO_CHANGE",
    });
    await assert.rejects(revise(inbound.id, { quantity: 1.5 }, admin), {
      code: "INVALID_QUANTITY",
    });
    const [adj] = await rows<{ id: number }>(
      "SELECT id FROM stock_transactions WHERE product_id=? AND transaction_type='ADJUSTMENT' ORDER BY id DESC LIMIT 1",
      [product],
    );
    await assert.rejects(revise(adj.id, { quantity: 1 }, admin), {
      code: "NOT_REVISABLE",
    });
    assert.equal((await p()).stock, 11);
  });
});

test("history 'Semua' lists every transaction type", async () => {
  const [{ total }] = await rows<{ total: number }>(
    "SELECT COUNT(*) total FROM stock_transactions",
  );
  const all = await history(null, listSchema.parse({ limit: 100 }));
  assert.equal(all.total, total);
  const types = new Set(all.items.map((item) => item.transaction_type));
  for (const type of ["IN", "OUT", "ADJUSTMENT"]) assert.ok(types.has(type as "IN"), type);
});

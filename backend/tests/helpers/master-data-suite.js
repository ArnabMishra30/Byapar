import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma, resetDatabase, createCompanyWithUsers, login } from './db.js';

// Every master-data module must behave the same way for authentication, RBAC,
// tenant isolation, pagination and deactivation. Those tests are written once here
// and run against each module, so a module cannot quietly miss one of them.
// Module-specific rules (duplicate SKU, invalid tax rate, ...) live in the module's
// own test file.

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/**
 * @param {object} config
 * @param {string} config.resource       URL segment, e.g. 'categories'
 * @param {string} config.singular       key in single-item responses, e.g. 'category'
 * @param {(ctx: object) => object} config.payload            valid create body
 * @param {object} config.update                              valid update body
 * @param {object} config.invalid                             body that must fail validation
 * @param {string} [config.identityField]                     field compared across tenants
 * @param {(companyId: string, token: string) => Promise<object>} [config.prepare]
 *        creates any records the payload depends on, per company
 */
export function runMasterDataSuite(config) {
  const {
    resource,
    singular,
    payload,
    update,
    invalid,
    identityField = 'name',
    prepare = async () => ({}),
  } = config;

  describe(`${resource}: shared master-data behaviour`, () => {
    let companyA;
    let companyB;
    let adminAToken;
    let staffAToken;
    let adminBToken;
    let ctxA;
    let recordA;
    let recordB;

    beforeAll(async () => {
      await resetDatabase();

      companyA = await createCompanyWithUsers('alpha');
      companyB = await createCompanyWithUsers('beta');

      adminAToken = await login(app, companyA.admin.email, companyA.adminPassword);
      staffAToken = await login(app, companyA.staff.email, companyA.staffPassword);
      adminBToken = await login(app, companyB.admin.email, companyB.adminPassword);

      ctxA = await prepare(companyA.company.id, adminAToken);
      const ctxB = await prepare(companyB.company.id, adminBToken);

      // Deliberately the SAME payload in both companies: master data names are
      // unique per company, not globally.
      const createdA = await request(app)
        .post(`/api/v1/${resource}`)
        .set(auth(adminAToken))
        .send(payload(ctxA));
      const createdB = await request(app)
        .post(`/api/v1/${resource}`)
        .set(auth(adminBToken))
        .send(payload(ctxB));

      expect(createdA.status).toBe(201);
      expect(createdB.status).toBe(201);

      recordA = createdA.body.data[singular];
      recordB = createdB.body.data[singular];
    });

    afterAll(async () => {
      await resetDatabase();
      await prisma.$disconnect();
    });

    describe('authentication and RBAC', () => {
      it('rejects an unauthenticated list', async () => {
        const response = await request(app).get(`/api/v1/${resource}`);
        expect(response.status).toBe(401);
      });

      it('rejects an unauthenticated create', async () => {
        const response = await request(app).post(`/api/v1/${resource}`).send({});
        expect(response.status).toBe(401);
      });

      it('lets STAFF read the list', async () => {
        const response = await request(app).get(`/api/v1/${resource}`).set(auth(staffAToken));
        expect(response.status).toBe(200);
      });

      it('lets STAFF read one record', async () => {
        const response = await request(app)
          .get(`/api/v1/${resource}/${recordA.id}`)
          .set(auth(staffAToken));
        expect(response.status).toBe(200);
      });

      it('forbids STAFF from creating', async () => {
        const response = await request(app)
          .post(`/api/v1/${resource}`)
          .set(auth(staffAToken))
          .send(payload(ctxA));
        expect(response.status).toBe(403);
      });

      it('forbids STAFF from updating', async () => {
        const response = await request(app)
          .patch(`/api/v1/${resource}/${recordA.id}`)
          .set(auth(staffAToken))
          .send(update);
        expect(response.status).toBe(403);
      });

      it('forbids STAFF from changing status', async () => {
        const response = await request(app)
          .patch(`/api/v1/${resource}/${recordA.id}/status`)
          .set(auth(staffAToken))
          .send({ isActive: false });
        expect(response.status).toBe(403);
      });
    });

    describe('tenant isolation', () => {
      it('allows the same values in a different company', () => {
        // Both records were created in beforeAll with identical payloads.
        expect(recordA[identityField]).toBe(recordB[identityField]);
        expect(recordA.id).not.toBe(recordB.id);
      });

      it('lists only the current company records', async () => {
        const response = await request(app).get(`/api/v1/${resource}`).set(auth(adminAToken));
        const ids = response.body.data.map((item) => item.id);

        expect(ids).toContain(recordA.id);
        expect(ids).not.toContain(recordB.id);
      });

      it('returns 404 when reading another company record', async () => {
        const response = await request(app)
          .get(`/api/v1/${resource}/${recordB.id}`)
          .set(auth(adminAToken));
        expect(response.status).toBe(404);
      });

      it('returns 404 when updating another company record, and changes nothing', async () => {
        const before = await request(app)
          .get(`/api/v1/${resource}/${recordB.id}`)
          .set(auth(adminBToken));

        const response = await request(app)
          .patch(`/api/v1/${resource}/${recordB.id}`)
          .set(auth(adminAToken))
          .send(update);
        expect(response.status).toBe(404);

        const after = await request(app)
          .get(`/api/v1/${resource}/${recordB.id}`)
          .set(auth(adminBToken));
        expect(after.body.data[singular]).toEqual(before.body.data[singular]);
      });

      it('returns 404 when deactivating another company record', async () => {
        const response = await request(app)
          .patch(`/api/v1/${resource}/${recordB.id}/status`)
          .set(auth(adminAToken))
          .send({ isActive: false });
        expect(response.status).toBe(404);

        const after = await request(app)
          .get(`/api/v1/${resource}/${recordB.id}`)
          .set(auth(adminBToken));
        expect(after.body.data[singular].isActive).toBe(true);
      });

      it('ignores a companyId sent in the create body', async () => {
        const response = await request(app)
          .post(`/api/v1/${resource}`)
          .set(auth(adminAToken))
          .send({ ...payload(ctxA, 'injected'), companyId: companyB.company.id });

        expect(response.status).toBe(201);

        // The record must be readable by company A and invisible to company B.
        const readByA = await request(app)
          .get(`/api/v1/${resource}/${response.body.data[singular].id}`)
          .set(auth(adminAToken));
        const readByB = await request(app)
          .get(`/api/v1/${resource}/${response.body.data[singular].id}`)
          .set(auth(adminBToken));

        expect(readByA.status).toBe(200);
        expect(readByB.status).toBe(404);
      });

      it('never exposes companyId in the response body', async () => {
        const response = await request(app)
          .get(`/api/v1/${resource}/${recordA.id}`)
          .set(auth(adminAToken));
        expect(response.body.data[singular].companyId).toBeUndefined();
      });
    });

    describe('reading', () => {
      it('returns the standard pagination block', async () => {
        const response = await request(app)
          .get(`/api/v1/${resource}?page=1&limit=2`)
          .set(auth(adminAToken));

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body.data)).toBe(true);
        expect(response.body.pagination).toMatchObject({ page: 1, limit: 2 });
        expect(response.body.pagination.total).toBeGreaterThan(0);
      });

      it('rejects a limit above the maximum', async () => {
        const response = await request(app)
          .get(`/api/v1/${resource}?limit=500`)
          .set(auth(adminAToken));

        expect(response.status).toBe(400);
        expect(response.body.errors[0].field).toBe('query.limit');
      });

      it('rejects a malformed id without leaking a database error', async () => {
        const response = await request(app)
          .get(`/api/v1/${resource}/not-a-uuid`)
          .set(auth(adminAToken));

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body).toLowerCase()).not.toContain('prisma');
      });

      it('returns 404 for a well-formed id that does not exist', async () => {
        const response = await request(app)
          .get(`/api/v1/${resource}/00000000-0000-4000-8000-000000000000`)
          .set(auth(adminAToken));

        expect(response.status).toBe(404);
      });
    });

    describe('writing', () => {
      it('updates a record', async () => {
        const response = await request(app)
          .patch(`/api/v1/${resource}/${recordA.id}`)
          .set(auth(adminAToken))
          .send(update);

        expect(response.status).toBe(200);
        for (const [key, value] of Object.entries(update)) {
          expect(String(response.body.data[singular][key])).toBe(String(value));
        }
      });

      it('rejects an empty update', async () => {
        const response = await request(app)
          .patch(`/api/v1/${resource}/${recordA.id}`)
          .set(auth(adminAToken))
          .send({});

        expect(response.status).toBe(400);
      });

      it('rejects an invalid create payload', async () => {
        const response = await request(app)
          .post(`/api/v1/${resource}`)
          .set(auth(adminAToken))
          .send(invalid);

        expect(response.status).toBe(400);
        expect(response.body.message).toBe('Validation failed');
      });

      it('deactivates and reactivates a record instead of deleting it', async () => {
        const created = await request(app)
          .post(`/api/v1/${resource}`)
          .set(auth(adminAToken))
          .send(payload(ctxA, 'status'));

        const id = created.body.data[singular].id;

        const deactivated = await request(app)
          .patch(`/api/v1/${resource}/${id}/status`)
          .set(auth(adminAToken))
          .send({ isActive: false });

        expect(deactivated.status).toBe(200);
        expect(deactivated.body.data[singular].isActive).toBe(false);

        // Still readable: master data is never hard deleted.
        const stillThere = await request(app)
          .get(`/api/v1/${resource}/${id}`)
          .set(auth(adminAToken));
        expect(stillThere.status).toBe(200);

        // And filterable.
        const inactiveList = await request(app)
          .get(`/api/v1/${resource}?isActive=false`)
          .set(auth(adminAToken));
        expect(inactiveList.body.data.map((item) => item.id)).toContain(id);

        const reactivated = await request(app)
          .patch(`/api/v1/${resource}/${id}/status`)
          .set(auth(adminAToken))
          .send({ isActive: true });
        expect(reactivated.body.data[singular].isActive).toBe(true);
      });

      it('rejects a non-boolean status', async () => {
        const response = await request(app)
          .patch(`/api/v1/${resource}/${recordA.id}/status`)
          .set(auth(adminAToken))
          .send({ isActive: 'yes' });

        expect(response.status).toBe(400);
      });

      it('has no DELETE endpoint', async () => {
        const response = await request(app)
          .delete(`/api/v1/${resource}/${recordA.id}`)
          .set(auth(adminAToken));

        expect(response.status).toBe(404);
      });
    });
  });
}

// js/config.js — Bahr Coffee Store POS Configuration
// Service Account credentials + Spreadsheet ID

const CONFIG = {

  // ── Google Sheets Spreadsheet ID ────────────────────────────────
  SPREADSHEET_ID: '1WpzhVCLM3RIOaOIUt07ttbOtEJHE7lO8NJg6LYpFiAQ',

  // ── Service Account credentials ──────────────────────────────────
  SERVICE_ACCOUNT: {
    client_email: 'bahr-coffee-pos@ancient-pipe-500714-t0.iam.gserviceaccount.com',
    private_key_id: '2d8e9973ec24fd01414ba186d821898275f50e21',
    private_key: `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDDxM1ITcook6oO
5JDASYZE7PKMwtRBRGqtFIeOhjFzGOCKS7vDjtk7DVEM/Bdai6An9FYMO2MGwY8a
68CqPNPU8GXDpX8lwOYPODrpg/+w4jPdFVEDh1pegn9RtkGUGsQnujIVrDZ+T0V/
3NlfqCm08fHnHIZMgy3o0uiAsvStjqGOiwndKD15liOjw2EjQmwqqwgZc9C4YS+x
sYOfphsXty4HyI+NEAGyi/rqycYdrZ5GijVaTuedh8wtQkaVL3HipPAj+yzpxbeh
2MaIsfUsg5wqXwvj4Btq6rLHDrP5tI4WZ5W0grmSiRlQi8RI0DKKwh50+BBI1rRY
A3ZzDWapAgMBAAECggEAKeh/34oTjEMsJPsGB7vVm/yzYbG1eXFZesrJyBdvD4oU
S1ayD8eNNkiAAM0YfMAmHVd/cifmZ4RZC7TLLkZOPKfnyQ2tHdphBYIOjn2851NN
MfdFvAEmNdQuyEHBYSCnvC9uWFhg5AI5SQlwmTspDny6wbRIBaoRUmWP8zkcCuj8
6iSrLJXSVgttvyEFULsbraYjLZZdx8goX71Vv3elm0te8fKMXbCRkLWIB1ik6Qmv
ha9KajCXqjAh/WSJxCI3gqSkH4ZupB3zhFvPz1CMKRZIol0xGccHqpYqc1t7VSu6
xK93JXZw6blnrCwef0Pq0NhpWNd1CH2cd4Lk5FJ2NwKBgQD1SQVnpuAfWwJP4qyt
mop7Ce+LrrmoithqvfjYjalddFfpA2Y0I8SPMpqf1W9tjTE3a084RqmnpBp9TpjC
PbhhDbNcPP8fWGX05/tnMWuDy3PLm1VYhGQeCI1i8g2Vk+hh2I0+QfP16hy17ykD
Sf3CY/8NQsb2PT8EPG4ueg9wSwKBgQDMUgwXiY2dIci9KcAHHsRlts0ds0u1awms
nwXaugKPb+pPM9FufAbXjqOi6CkQhVggCC+cDm+PWptCtR8sI+9lC6VtUxSTBLHx
olQyDtq4eiccxl3k6jTvmv0jkqiWsvbPBJRgIm6twhdr9IkWmsPEDCvr6+EpqngF
Q/eEXfv0WwKBgCuf+R4eR+5LuXWL0zptKgQIGFq3kL2xNByH/SJGz8CXWKtQt3S+
h88QKQAUbeUGH6LDqytPJg1y2mM+/1xMreZVEXluP9HLXxbXy5bm60BdhxLHZb6A
jW3qB3t5oYDg9YuxgC16fXFXWhPhnWHAXymbr1kkb06MRhDyzoXln6lRAoGAa4L8
0+HQf49IZqkyX0zEQVVYRzmSK+sf0xJ2bSqVsE5Od9CnckCXBRQMbOtGuGfCAFDu
ZGqAL2mY6xgNSBe8n2nqaUVfPSEqVSB6t0BzvMCiFhUXUR4gLrhaXT6NsYaIMlSR
kqhrnsjTtD2faSKUwnM5JVIgT+FgeDzUYHVn36MCgYEAlxMZO5XVA+gryoqBzaYe
r+bTSL2D1YiSn6+BUiLdR+QLHHPRtqdvupcRouFm8W6ITvkzMVkcxzESaPriEK3D
nkabTkr39Goq+Z28UOmepu+KIlXk5D9drzdZS+vkHfTise2BDQtYSJVlvkaU2EAj
sbj4IVSWCZKFoG1GepHp9Gc=
-----END PRIVATE KEY-----`,
  },

  // ── Sheet tab names (do not change) ─────────────────────────────
  SHEETS: {
    ORDERS:      'Orders',
    CUSTOMERS:   'Customers',
    ORDER_ITEMS: 'Order_Items',
    CATALOG:     'Catalog',
  },

  // ── Default catalog seeded on first run ──────────────────────────
  DEFAULT_CATALOG: [
    [1, 'حبشي هرهري',     'Ethiopian Harari',   'coffee',     440, 'kg',    1],
    [2, 'برازيلي سانتوس', 'Brazilian Santos',   'coffee',     580, 'kg',    1],
    [3, 'إندونيسي',        'Indonesian',         'coffee',     300, 'kg',    1],
    [4, 'هندي أرابيكا',    'Indian Arabica',     'coffee',     700, 'kg',    1],
    [5, 'باكيت ٢٥٠ جم',    '250g Pack',          'package',     15, 'piece', 1],
    [6, 'باكيت ٥٠٠ جم',    '500g Pack',          'package',     25, 'piece', 1],
    [7, 'سكر',             'Sugar',              'ingredient',  30, 'kg',    1],
    [8, 'هيل',             'Cardamom',           'ingredient', 250, 'kg',    1],
  ],
};

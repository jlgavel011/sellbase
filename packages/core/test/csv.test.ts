import { describe, expect, it } from 'vitest';
import { parseCsv, productsFromCsv, slugify } from '../src/csv.js';

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, CRLF and BOM', () => {
    const rows = parseCsv('﻿title,description\r\n"Taza, grande","Dice ""hola"""\r\nPlato,\n');
    expect(rows).toEqual([
      ['title', 'description'],
      ['Taza, grande', 'Dice "hola"'],
      ['Plato', ''],
    ]);
  });

  it('keeps line breaks inside quotes and detects semicolons', () => {
    expect(parseCsv('a;b\n"x\ny";2')).toEqual([
      ['a', 'b'],
      ['x\ny', '2'],
    ]);
  });
});

describe('slugify', () => {
  it('strips accents and symbols', () => {
    expect(slugify('Café Ñandú — 100%')).toBe('cafe-nandu-100');
    expect(slugify('***')).toBe('product');
  });
});

describe('productsFromCsv', () => {
  it('reads our template with Spanish headers', () => {
    const { products, errors } = productsFromCsv(
      'nombre,precio,sku,existencias,estado,tipo,peso\nTaza,149.50,TZ-1,10,activo,físico,350\nEbook,99,,,,digital,',
      'MXN',
    );
    expect(errors).toEqual([]);
    expect(products).toHaveLength(2);
    expect(products[0]).toMatchObject({
      slug: 'taza',
      type: 'physical',
      status: 'active',
      variants: [
        {
          sku: 'TZ-1',
          title: 'Default',
          price_amount: 14950,
          stock: 10,
          physical: { weight_g: 350 },
        },
      ],
    });
    expect(products[1]).toMatchObject({
      type: 'digital',
      status: 'draft',
      variants: [{ price_amount: 9900, stock: null, physical: null }],
    });
  });

  it('groups Shopify rows by handle into variants and images', () => {
    const csv = [
      'Handle,Title,Body (HTML),Type,Tags,Published,Option1 Name,Option1 Value,Variant SKU,Variant Grams,Variant Inventory Qty,Variant Price,Variant Compare At Price,Image Src,Status',
      'playera,Playera,<p>Algodón</p>,Ropa,"verano, algodón",TRUE,Talla,M,PL-M,200,5,349.00,399.00,https://cdn.test/a.jpg,active',
      'playera,,,,,,,L,PL-L,200,3,349.00,,https://cdn.test/b.jpg,',
      'playera,,,,,,,,,,,,,https://cdn.test/c.jpg,',
    ].join('\n');
    const { products, errors } = productsFromCsv(csv, 'MXN');
    expect(errors).toEqual([]);
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      slug: 'playera',
      type: 'physical', // Shopify "Type" is a category, not ours
      status: 'active',
      tags: ['verano', 'algodón'],
      options: [{ name: 'Talla', values: ['M', 'L'] }],
      images: ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg', 'https://cdn.test/c.jpg'],
    });
    expect(
      products[0]?.variants.map((v) => [v.title, v.sku, v.stock, v.compare_at_amount]),
    ).toEqual([
      ['M', 'PL-M', 5, 39900],
      ['L', 'PL-L', 3, null],
    ]);
  });

  it('reports row errors with hints and keeps the valid rows', () => {
    const { products, errors } = productsFromCsv(
      'title,price,stock,type\nBuena,10,1,\nMala,$abc,1,\nStock raro,10,1.5,\nConsulta,500,,service\nSin precio,,,',
      'MXN',
    );
    expect(products.map((p) => p.title)).toEqual(['Buena']);
    expect(errors.map((e) => e.row)).toEqual([3, 4, 5, 6]);
    expect(errors.find((e) => e.row === 5)?.hint).toContain('product_upsert');
  });

  it('explains a missing header', () => {
    const { errors } = productsFromCsv('nombre,color\nTaza,azul', 'MXN');
    expect(errors[0]?.message).toContain('title and price');
  });
});

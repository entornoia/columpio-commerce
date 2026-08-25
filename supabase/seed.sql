insert into public.products (id, sku, name, description, category, subcategory, price, style, season, formality, fit, material, occasions)
values
('10000000-0000-0000-0000-000000000001', 'CM-001', 'Blazer Emilia', 'Blazer estructurado de líneas limpias.', 'Chaquetas', 'Blazers', 54990, 'Clásico', 'Todo el año', 'Semi formal', 'Regular', 'Poliéster y viscosa', array['Oficina','Cena']),
('10000000-0000-0000-0000-000000000002', 'CM-002', 'Pantalón Renata', 'Pantalón sastrero de tiro alto.', 'Pantalones', 'Sastreros', 42990, 'Minimalista', 'Todo el año', 'Semi formal', 'Recto', 'Viscosa', array['Oficina','Evento']),
('10000000-0000-0000-0000-000000000003', 'CM-003', 'Blusa Amelia', 'Blusa fluida de cuello redondo.', 'Tops', 'Blusas', 32990, 'Romántico', 'Primavera verano', 'Casual elegante', 'Holgado', 'Rayón', array['Oficina','Fin de semana']);

insert into public.product_variants (product_id, variant_sku, color, size, stock) values
('10000000-0000-0000-0000-000000000001', 'CM-001-NEG-S', 'Negro', 'S', 2),
('10000000-0000-0000-0000-000000000001', 'CM-001-NEG-M', 'Negro', 'M', 1),
('10000000-0000-0000-0000-000000000001', 'CM-001-NEG-L', 'Negro', 'L', 0),
('10000000-0000-0000-0000-000000000001', 'CM-001-CAM-S', 'Camel', 'S', 1),
('10000000-0000-0000-0000-000000000001', 'CM-001-CAM-M', 'Camel', 'M', 3),
('10000000-0000-0000-0000-000000000002', 'CM-002-NEG-S', 'Negro', 'S', 4),
('10000000-0000-0000-0000-000000000002', 'CM-002-NEG-M', 'Negro', 'M', 2),
('10000000-0000-0000-0000-000000000003', 'CM-003-MAR-S', 'Marfil', 'S', 3),
('10000000-0000-0000-0000-000000000003', 'CM-003-MAR-M', 'Marfil', 'M', 2);


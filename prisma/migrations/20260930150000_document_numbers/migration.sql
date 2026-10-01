-- Customer-facing document numbers. Sequences never hand out the same value twice,
-- even under concurrent checkouts, and gaps from rolled-back transactions are acceptable.
CREATE SEQUENCE "order_no_seq" START WITH 10001;
CREATE SEQUENCE "quote_no_seq" START WITH 1001;

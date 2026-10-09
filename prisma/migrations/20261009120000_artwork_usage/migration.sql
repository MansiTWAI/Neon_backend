-- AI designer pictures each customer has asked for, per day, to share the free allowance fairly.
CREATE TABLE "artwork_usage" (
    "userId" UUID NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "artwork_usage_pkey" PRIMARY KEY ("userId","day")
);

ALTER TABLE "artwork_usage" ADD CONSTRAINT "artwork_usage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

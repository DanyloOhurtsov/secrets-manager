/*
  Warnings:

  - You are about to drop the column `encryptedValue` on the `Secret` table. All the data in the column will be lost.
  - Added the required column `ciphertext` to the `Secret` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dataKeyAuthTag` to the `Secret` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dataKeyIv` to the `Secret` table without a default value. This is not possible if the table is not empty.
  - Added the required column `encryptedDataKey` to the `Secret` table without a default value. This is not possible if the table is not empty.
  - Added the required column `keyVersion` to the `Secret` table without a default value. This is not possible if the table is not empty.
  - Added the required column `valueAuthTag` to the `Secret` table without a default value. This is not possible if the table is not empty.
  - Added the required column `valueIv` to the `Secret` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Secret" DROP COLUMN "encryptedValue",
ADD COLUMN     "ciphertext" BYTEA NOT NULL,
ADD COLUMN     "dataKeyAuthTag" BYTEA NOT NULL,
ADD COLUMN     "dataKeyIv" BYTEA NOT NULL,
ADD COLUMN     "encryptedDataKey" BYTEA NOT NULL,
ADD COLUMN     "keyVersion" TEXT NOT NULL,
ADD COLUMN     "valueAuthTag" BYTEA NOT NULL,
ADD COLUMN     "valueIv" BYTEA NOT NULL;

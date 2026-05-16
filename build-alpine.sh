name: Build Randy OS Installer
on: workflow_dispatch

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Make script executable
        run: chmod +x build-alpine.sh

      - name: Run Native Mkimage Compiler (via Alpine Docker)
        run: |
          docker run --rm -v ${{ github.workspace }}:/workspace -w /workspace alpine:latest sh -c "apk add alpine-sdk build-base apk-tools alpine-conf squashfs-tools xorriso mtools grub-efi curl git && ./build-alpine.sh"

      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          name: Randy OS Installer (Native)
          tag_name: latest
          files: randy-os-installer.iso
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
{
  description = "Export Confluence pages as PDF files";

  inputs = {
    nixpkgs.url = github:NixOS/nixpkgs/nixos-22.11;
    napalm.url = "github:nix-community/napalm";
  };

  outputs = { self, nixpkgs, napalm }:
  let
    system = "x86_64-linux";
    pkgs = nixpkgs.legacyPackages."${system}";
  in {
    packages."${system}".default = napalm.legacyPackages."${system}".buildPackage ./. {
      nativeBuildInputs = with pkgs; [ nodejs ];
      buildInputs = [ pkgs.makeWrapper ];
      preNpmHook = ''
      export PUPPETEER_SKIP_DOWNLOAD=1
      '';
      postInstall = ''
        wrapProgram $out/bin/confluence-offline-copy \
          --set PUPPETEER_EXECUTABLE_PATH ${pkgs.chromium.outPath}/bin/chromium
      '';
    };

    devShells."${system}".confluence-offline-copy-shell = pkgs.mkShell {
      nativeBuildInputs = with pkgs; [ nodejs ];
    };
  };
}

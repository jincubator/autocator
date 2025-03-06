import { ConnectButton } from '@rainbow-me/rainbowkit';

export function WalletConnect() {
  return (
    <div className="flex items-center justify-end">
      <ConnectButton
        showBalance={true}
        accountStatus={{ smallScreen: 'avatar', largeScreen: 'full' }}
        chainStatus={{ smallScreen: 'icon', largeScreen: 'full' }}
      />
    </div>
  );
}

/**
 * PlatformLoginEntry —— 欢迎页平台账号登录主入口。
 *
 * 等待/失败状态与 API Key 表单相互独立：平台登录由 Host 服务持有，
 * 这里取消只结束本次等待，不影响 API Key / 跳过等其它入口。
 */
import type { PlatformSessionInfo } from "@shucode/shared";
import {
  TID_LOGIN_PLATFORM_BUTTON,
  TID_LOGIN_PLATFORM_CANCEL,
  TID_LOGIN_PLATFORM_ERROR,
  TID_LOGIN_PLATFORM_WAITING,
} from "@shucode/shared";
import { Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert.js";
import { Button } from "@/components/ui/button.js";
import { usePlatformLogin } from "@/hooks/usePlatformLogin.js";
import { useShucodeIntl } from "@/i18n/IntlProvider.js";

export function PlatformLoginEntry({
  onCompleted,
}: {
  onCompleted: (session: PlatformSessionInfo) => void | Promise<void>;
}) {
  const { intl } = useShucodeIntl();
  const { available, status, startLogin, cancel } = usePlatformLogin({ onSuccess: onCompleted });

  if (!available) {
    return null;
  }

  if (status === "waiting") {
    return (
      <div className="space-y-2" data-testid={TID_LOGIN_PLATFORM_WAITING}>
        <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface p-2 text-ui-base text-foreground-subtle">
          <Loader2Icon className="size-4 animate-spin" />
          {intl.formatMessage({ id: "login.platform.waiting" })}
        </div>
        <Button
          variant="outline"
          className="h-10 w-full text-ui-base"
          size="lg"
          data-testid={TID_LOGIN_PLATFORM_CANCEL}
          onClick={() => void cancel()}
        >
          {intl.formatMessage({ id: "login.oauth.cancel" })}
        </Button>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="space-y-2" data-testid={TID_LOGIN_PLATFORM_ERROR}>
        <Alert variant="warning" className="flex items-center justify-center gap-2 text-center">
          <TriangleAlertIcon className="size-4" />
          <AlertDescription className="text-center">
            {intl.formatMessage({ id: "login.platform.failure" })}
          </AlertDescription>
        </Alert>
        <Button className="h-10 w-full text-ui-base" size="lg" onClick={() => void startLogin()}>
          {intl.formatMessage({ id: "login.oauth.retry" })}
        </Button>
        <Button
          variant="outline"
          className="h-10 w-full text-ui-base"
          size="lg"
          data-testid={TID_LOGIN_PLATFORM_CANCEL}
          onClick={() => void cancel()}
        >
          {intl.formatMessage({ id: "login.oauth.cancel" })}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button
        className="h-10 w-full text-ui-base"
        size="lg"
        data-testid={TID_LOGIN_PLATFORM_BUTTON}
        onClick={() => void startLogin()}
      >
        {intl.formatMessage({ id: "login.platform.button" })}
      </Button>
      <p className="text-ui-sm text-foreground-subtle">
        {intl.formatMessage({ id: "login.platform.hint" })}
      </p>
    </div>
  );
}
